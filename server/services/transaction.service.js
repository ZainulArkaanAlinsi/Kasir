/**
 * Layanan transaksi penjualan.
 *
 * Ini titik paling kritikal di seluruh sistem: di sinilah uang dan stok
 * berubah. Aturan yang ditegakkan modul ini:
 *
 *  1. Harga TIDAK PERNAH diambil dari browser. Browser hanya boleh mengirim
 *     productId + qty; harga jual dan harga modal dibaca ulang dari Firestore
 *     di dalam transaksi.
 *  2. Pengecekan stok dan pengurangan stok terjadi di dalam satu
 *     Firestore transaction, sehingga dua kasir yang checkout barang sama
 *     pada saat bersamaan tidak bisa membuat stok minus. Sejak M8, yang
 *     dicek adalah stok TERSEDIA (stok fisik dikurangi yang sudah dipesan
 *     lewat etalase), supaya kasir tidak menjual barang yang sudah disisihkan
 *     untuk pesanan online.
 *  3. Harga jual & harga modal di-SNAPSHOT ke dalam dokumen transaksi,
 *     supaya laporan laba historis tetap benar walau harga berubah nanti.
 */
import { getDb, admin } from "./firebase.js";
import { computeTotals, computeChange } from "../../public/js/shared/money.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { requireCartItems, requireEnum, requireNumber } from "../lib/validate.js";
import { stokTersedia } from "../../public/js/shared/product.js";

export const PAYMENT_METHODS = Object.freeze(["cash", "card", "qris"]);

/** Membuat nomor struk yang mudah dibaca manusia. */
function buildReceiptNumber(now = new Date()) {
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  const random = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `TRX-${stamp}-${random}`;
}

/**
 * Memproses satu transaksi penjualan secara atomik.
 *
 * @param {object} input
 * @param {Array<{productId:string, qty:number}>} input.items dari browser
 * @param {string} input.paymentMethod "cash" | "card" | "qris"
 * @param {number} [input.cashReceived] wajib bila paymentMethod "cash"
 * @param {number} [input.discount] diskon rupiah, divalidasi ulang di sini
 * @param {string|null} [input.qrisReference] nomor referensi manual QRIS
 * @param {{uid:string, name:string, email:string|null}} input.cashier
 * @returns {Promise<object>} dokumen transaksi yang tersimpan
 * @throws {AppError} 400 input tidak valid, 404 produk hilang, 409 stok kurang
 */
export async function createTransaction(input) {
  const items = requireCartItems(input?.items);
  const paymentMethod = requireEnum(input?.paymentMethod, "Metode pembayaran", PAYMENT_METHODS);
  const requestedDiscount = input?.discount == null
    ? 0
    : requireNumber(input.discount, "Diskon", { min: 0 });

  const cashier = input?.cashier;
  if (!cashier?.uid) throw badRequest("Data kasir tidak lengkap.");

  const db = getDb();
  const productRefs = items.map((item) => db.collection("products").doc(item.productId));

  return db.runTransaction(async (tx) => {
    // --- FASE BACA: Firestore mewajibkan semua read sebelum write ---
    const snapshots = await tx.getAll(...productRefs);

    const lines = [];
    const kurang = [];

    snapshots.forEach((snap, i) => {
      const { productId, qty } = items[i];
      if (!snap.exists) throw notFound(`Produk tidak ditemukan (${productId}).`);

      const product = snap.data();
      if (product.aktif === false) {
        throw badRequest(`Produk "${product.name}" sudah dinonaktifkan.`, "PRODUCT_INACTIVE");
      }

      // Yang dipakai adalah stok TERSEDIA, bukan stok fisik. Barang yang
      // sudah dikunci untuk pesanan online belum diambil pembelinya, tapi
      // juga tidak boleh dijual ulang di kasir.
      const tersedia = stokTersedia(product);
      if (tersedia < qty) {
        kurang.push({ productId, name: product.name, diminta: qty, tersedia });
        return;
      }

      lines.push({
        productId,
        name: product.name,
        sku: product.sku ?? null,
        // Snapshot harga: inilah yang membuat laporan historis kebal
        // terhadap perubahan harga produk di kemudian hari.
        hargaJual: Number(product.hargaJual) || 0,
        hargaModal: Number(product.hargaModal) || 0,
        qty
      });
    });

    // Satu pesan berisi SEMUA barang yang kurang, bukan gagal satu per satu.
    if (kurang.length > 0) {
      const ringkas = kurang.map((k) => `${k.name} (minta ${k.diminta}, sisa ${k.tersedia})`).join("; ");
      throw conflict(`Stok tidak mencukupi: ${ringkas}.`, "INSUFFICIENT_STOCK", { kurang });
    }

    // --- FASE HITUNG: pakai modul uang bersama, bukan angka dari browser ---
    const totals = computeTotals(lines, { discount: requestedDiscount });

    let cashReceived = null;
    let change = null;
    if (paymentMethod === "cash") {
      cashReceived = requireNumber(input?.cashReceived, "Uang diterima", { min: 0 });
      const result = computeChange(cashReceived, totals.total);
      if (!result.sufficient) {
        throw badRequest("Uang yang diterima kurang dari total tagihan.", "INSUFFICIENT_CASH");
      }
      change = result.change;
    }

    // --- FASE TULIS ---
    const trxRef = db.collection("transactions").doc();
    const receiptNumber = buildReceiptNumber();

    snapshots.forEach((snap, i) => {
      tx.update(productRefs[i], {
        stok: admin.firestore.FieldValue.increment(-items[i].qty),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    const doc = {
      receiptNumber,
      cashierUid: cashier.uid,
      cashierName: cashier.name || cashier.email || "Kasir",
      paymentMethod,
      cashReceived,
      change,
      qrisReference: paymentMethod === "qris" ? (input?.qrisReference ?? null) : null,
      cardReference: paymentMethod === "card" ? (input?.cardReference ?? null) : null,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      total: totals.total,
      itemCount: lines.reduce((sum, l) => sum + l.qty, 0),
      lines,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    tx.set(trxRef, doc);

    tx.set(db.collection("auditLogs").doc(), {
      uid: cashier.uid,
      email: cashier.email ?? null,
      action: "CREATE_TRANSACTION",
      metadata: { transactionId: trxRef.id, receiptNumber, total: totals.total, itemCount: doc.itemCount },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { id: trxRef.id, ...doc, createdAt: new Date().toISOString() };
  });
}

/**
 * Riwayat transaksi dengan filter opsional.
 * @param {{from?:Date, to?:Date, cashierUid?:string, limit?:number}} [filter]
 * @returns {Promise<Array<object>>}
 */
export async function listTransactions(filter = {}) {
  const db = getDb();
  let query = db.collection("transactions").orderBy("createdAt", "desc");

  if (filter.from) query = query.where("createdAt", ">=", filter.from);
  if (filter.to) query = query.where("createdAt", "<=", filter.to);
  if (filter.cashierUid) query = query.where("cashierUid", "==", filter.cashierUid);

  const snap = await query.limit(Math.min(filter.limit ?? 100, 500)).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null }));
}
