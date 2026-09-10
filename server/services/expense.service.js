/**
 * Layanan pengeluaran (restock & operasional).
 *
 * Restock sengaja dibuat ATOMIK: menambah stok dan mencatat pengeluaran
 * adalah satu aksi. Kalau dipisah jadi dua langkah, sangat mungkin stok
 * bertambah tapi biayanya lupa dicatat — dan laporan laba langsung salah.
 */
import { getDb, admin } from "./firebase.js";
import { notFound } from "../lib/errors.js";
import { requireEnum, requireNumber, requireString } from "../lib/validate.js";

export const EXPENSE_TYPES = Object.freeze(["restock", "operasional", "lainnya"]);

/**
 * Mencatat pengeluaran operasional/lainnya (tanpa menyentuh stok).
 * @param {{type:string, amount:number, note?:string}} body
 * @param {{uid:string}} user
 * @returns {Promise<object>}
 */
export async function createExpense(body, user) {
  const type = requireEnum(body?.type, "Jenis pengeluaran", EXPENSE_TYPES);
  if (type === "restock") {
    // Restock punya jalur sendiri karena harus mengubah stok secara atomik.
    return restockProduct(body, user);
  }

  const amount = requireNumber(body?.amount, "Nominal", { min: 1, integer: true });
  const note = body?.note ? requireString(body.note, "Catatan", { max: 300 }) : "";

  const ref = getDb().collection("expenses").doc();
  await ref.set({
    type, amount, note,
    productId: null, qty: null,
    createdBy: user.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { id: ref.id, type, amount, note };
}

/**
 * Restock: menambah stok produk DAN mencatat pengeluaran dalam satu transaksi.
 * Nominal dihitung dari hargaModal tersimpan (bukan kiriman browser), kecuali
 * admin secara eksplisit mengirim hargaModalBaru karena harga kulakan berubah.
 *
 * @param {{productId:string, qty:number, hargaModalBaru?:number, note?:string}} body
 * @param {{uid:string}} user
 * @returns {Promise<object>}
 */
export async function restockProduct(body, user) {
  const productId = requireString(body?.productId, "Produk", { max: 128 });
  const qty = requireNumber(body?.qty, "Jumlah restock", { min: 1, max: 100000, integer: true });
  const note = body?.note ? requireString(body.note, "Catatan", { max: 300 }) : "";
  const hargaModalBaru = body?.hargaModalBaru == null
    ? null
    : requireNumber(body.hargaModalBaru, "Harga modal baru", { min: 0, integer: true });

  const db = getDb();
  const productRef = db.collection("products").doc(productId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(productRef);
    if (!snap.exists) throw notFound("Produk tidak ditemukan.");

    const product = snap.data();
    const hargaModal = hargaModalBaru ?? (Number(product.hargaModal) || 0);
    const amount = hargaModal * qty;

    const productUpdate = {
      stok: admin.firestore.FieldValue.increment(qty),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (hargaModalBaru !== null) productUpdate.hargaModal = hargaModalBaru;
    tx.update(productRef, productUpdate);

    const expenseRef = db.collection("expenses").doc();
    tx.set(expenseRef, {
      type: "restock",
      productId,
      productName: product.name,
      qty,
      hargaModal,
      amount,
      note,
      createdBy: user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    tx.set(db.collection("auditLogs").doc(), {
      uid: user.uid,
      action: "RESTOCK",
      metadata: { productId, productName: product.name, qty, amount },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      id: expenseRef.id, type: "restock", productId, productName: product.name,
      qty, hargaModal, amount, stokBaru: (Number(product.stok) || 0) + qty
    };
  });
}

/**
 * @param {{from?:Date, to?:Date, limit?:number}} [filter]
 * @returns {Promise<Array<object>>}
 */
export async function listExpenses(filter = {}) {
  let query = getDb().collection("expenses").orderBy("createdAt", "desc");
  if (filter.from) query = query.where("createdAt", ">=", filter.from);
  if (filter.to) query = query.where("createdAt", "<=", filter.to);

  const snap = await query.limit(Math.min(filter.limit ?? 100, 500)).get();
  return snap.docs.map((d) => ({
    id: d.id, ...d.data(),
    createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null
  }));
}
