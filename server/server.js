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
import { verifyFirebaseToken, attachRole } from "./middleware/auth.js";
import { errorHandler, notFoundHandler, asyncHandler } from "./middleware/errorHandler.js";
import { productsRouter } from "./routes/products.routes.js";
import { transactionsRouter } from "./routes/transactions.routes.js";
import { expensesRouter } from "./routes/expenses.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";
import { paymentsRouter } from "./routes/payments.routes.js";
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

app.use("/api/products", guarded, productsRouter);
app.use("/api/transactions", guarded, transactionsRouter);
app.use("/api/expenses", guarded, expensesRouter);
app.use("/api/reports", guarded, reportsRouter);
app.use("/api/payments", guarded, paymentsRouter);

app.use(notFoundHandler);

// --- Frontend statis ---
app.use(express.static(PUBLIC_DIR));
app.get("*splat", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.use(errorHandler);

// Hanya menyalakan server bila dijalankan langsung, bukan saat diimpor test.
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => console.log(`KasirOne berjalan di http://localhost:${PORT}`));
}
