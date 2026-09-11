/**
 * Titik masuk aplikasi KasirOne.
 *
 * File ini sengaja dijaga tetap tipis: isinya hanya perakitan (wiring)
 * middleware dan rute. Seluruh logika bisnis tinggal di server/services/*,
 * sehingga logika yang sama bisa dipindah ke Cloud Function nanti tanpa
 * menyentuh Express sama sekali.
 */
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";

import { initFirebase, isFirebaseReady } from "./services/firebase.js";
import { verifyFirebaseToken, attachRole, hanyaStaf } from "./middleware/auth.js";
import { errorHandler, notFoundHandler, asyncHandler } from "./middleware/errorHandler.js";
import { productsRouter } from "./routes/products.routes.js";
import { transactionsRouter } from "./routes/transactions.routes.js";
import { expensesRouter } from "./routes/expenses.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";
import { paymentsRouter } from "./routes/payments.routes.js";
import { ordersRouter } from "./routes/orders.routes.js";
import { verifikasiTandaTanganWebhook, bacaStatusWebhook } from "./services/payment.service.js";
import { daftarPesanan, ubahStatus, STATUS as ORDER_STATUS } from "./services/order.service.js";
import { getDb, admin } from "./services/firebase.js";
import { requireString } from "./lib/validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || `http://localhost:${PORT}`;
const PUBLIC_DIR = path.join(__dirname, "../public");

const firebaseReady = initFirebase();
console.log(firebaseReady
  ? "Firebase Admin siap."
  : "Firebase Admin BELUM dikonfigurasi — endpoint /api yang butuh auth akan menolak (mode demo tetap jalan).");

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: CLIENT_ORIGIN, methods: ["GET", "POST", "PATCH", "DELETE"], credentials: true }));
// 1 MB, bukan 100 KB: produk kini membawa foto sebagai data URL. Batas ini
// tetap konservatif karena browser sudah mengecilkan foto ke sisi 640px.
app.use(express.json({ limit: "1mb" }));

app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Terlalu banyak request. Coba lagi beberapa menit.", code: "RATE_LIMITED" }
}));

// --- Rute publik ---
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "kasirone", firebase: isFirebaseReady(), time: new Date().toISOString() });
});

/**
 * Pemberitahuan pembayaran dari Midtrans (M12).
 *
 * Sengaja TANPA login: yang memanggil adalah server Midtrans, bukan pengguna.
 * Sebagai gantinya, keasliannya dibuktikan lewat tanda tangan SHA-512. Tanpa
 * pemeriksaan itu siapa pun yang tahu alamat ini bisa mengirim "pesanan sudah
 * lunas" lalu mengambil barang tanpa membayar.
 *
 * Webhook dipakai karena status pembayaran tidak boleh bergantung pada
 * peramban pembeli — ia bisa saja sudah menutup tab sebelum pembayarannya
 * terkonfirmasi.
 */
app.post("/api/payments/webhook", asyncHandler(async (req, res) => {
  if (!verifikasiTandaTanganWebhook(req.body)) {
    console.warn("[webhook] tanda tangan ditolak", { orderId: req.body?.order_id });
    // Jawaban sengaja tidak menjelaskan apa yang salah.
    return res.status(403).json({ error: "Tanda tangan tidak sah.", code: "BAD_SIGNATURE" });
  }

  const { status, orderId } = bacaStatusWebhook(req.body);
  if (!orderId) return res.status(400).json({ error: "Order ID tidak ada.", code: "NO_ORDER_ID" });

  // paymentRef menyimpan orderId gateway; cocokkan ke pesanan kita.
  const cocok = (await daftarPesanan({ status: ORDER_STATUS.MENUNGGU_BAYAR, limit: 200 }))
    .find((o) => o.paymentRef === orderId || o.id === orderId || o.orderNumber === orderId);

  if (!cocok) {
    // Bukan kesalahan: bisa jadi pembayaran kasir, atau pesanan sudah
    // diproses lebih dulu lewat polling. Dijawab 200 supaya Midtrans tidak
    // mengirim ulang tanpa henti.
    return res.json({ ok: true, catatan: "Pesanan tidak ditemukan atau sudah diproses." });
  }

  if (status === "lunas") {
    await ubahStatus(cocok.id, ORDER_STATUS.DIBAYAR, { uid: "midtrans-webhook", role: "admin" },
      { paymentMethod: "qris", paymentRef: orderId });
  } else if (status === "gagal") {
    await ubahStatus(cocok.id, ORDER_STATUS.BATAL, { uid: "midtrans-webhook", role: "admin" });
  }

  res.json({ ok: true, status });
}));

// --- Semua rute di bawah ini wajib login & punya role ---
const guarded = [verifyFirebaseToken, attachRole];

app.get("/api/me", guarded, (req, res) => {
  res.json({ data: { uid: req.user.uid, email: req.user.email ?? null, role: req.userRole, name: req.user.name ?? null } });
});

app.post("/api/audit", guarded, asyncHandler(async (req, res) => {
  const action = requireString(req.body?.action, "Action", { min: 2, max: 100 });
  await getDb().collection("auditLogs").add({
    uid: req.user.uid,
    email: req.user.email ?? null,
    action,
    metadata: req.body?.metadata ?? {},
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.status(201).json({ ok: true });
}));

// Katalog boleh dibaca pelanggan (etalase membutuhkannya); penulisan tetap
// dijaga admin di dalam router.
app.use("/api/products", guarded, productsRouter);

// Kasir, riwayat transaksi toko, pengeluaran, dan laporan bukan urusan
// pelanggan sekalipun ia sudah login.
app.use("/api/transactions", guarded, hanyaStaf(), transactionsRouter);
app.use("/api/expenses", guarded, expensesRouter);
app.use("/api/reports", guarded, reportsRouter);

// Pembayaran dan pesanan dipakai bersama oleh kasir dan pelanggan.
app.use("/api/payments", guarded, paymentsRouter);
app.use("/api/orders", guarded, ordersRouter);

app.use(notFoundHandler);

// --- Frontend statis ---
app.use(express.static(PUBLIC_DIR));
app.get("*splat", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.use(errorHandler);

// Hanya menyalakan server bila dijalankan langsung, bukan saat diimpor test.
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => console.log(`KasirOne berjalan di http://localhost:${PORT}`));
}
