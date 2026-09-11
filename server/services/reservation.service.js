/**
 * Penguncian stok untuk pesanan online (M8).
 *
 * Kasir memotong stok saat itu juga karena pembeli sudah berdiri di depan.
 * Pesanan online tidak begitu: ada jeda antara "saya pesan" dan "saya bayar",
 * dan selama jeda itu barangnya harus disisihkan. Kalau tidak, satu Chitato
 * terakhir bisa dipesan pembeli online pada detik yang sama saat kasir
 * menjualnya di toko — dan toko berjanji pada dua orang untuk satu barang.
 *
 * Karena itu stok dipecah dua:
 *   stok        = jumlah fisik di rak
 *   stokDipesan = sudah dijanjikan ke pesanan yang belum selesai
 *   tersedia    = stok - stokDipesan   <- ini yang dipakai untuk memutuskan
 *
 * Tiga peristiwa yang mengubahnya:
 *   pesan   -> stokDipesan naik           (barang disisihkan)
 *   batal   -> stokDipesan turun          (barang dikembalikan ke rak)
 *   selesai -> stok DAN stokDipesan turun (barang benar-benar keluar)
 *
 * Ketiganya berjalan di dalam Firestore transaction supaya tidak ada celah
 * di antara membaca dan menulis.
 */
import { getDb, admin } from "./firebase.js";
import { conflict, notFound } from "../lib/errors.js";
import { requireCartItems } from "../lib/validate.js";
import { stokTersedia } from "../../public/js/shared/product.js";

/**
 * Mengunci stok untuk sebuah pesanan.
 *
 * @param {Array<{productId:string, qty:number}>} items
 * @returns {Promise<Array<{productId:string, name:string, sku:string|null, hargaJual:number, hargaModal:number, qty:number}>>}
 *          baris pesanan dengan harga yang di-snapshot dari database
 * @throws {AppError} 404 produk hilang, 409 stok tersedia tidak cukup
 */
export async function kunciStok(items) {
  const daftar = requireCartItems(items);
  const db = getDb();
  const refs = daftar.map((i) => db.collection("products").doc(i.productId));

  return db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...refs);

    const lines = [];
    const kurang = [];

    snaps.forEach((snap, i) => {
      const { productId, qty } = daftar[i];
      if (!snap.exists) throw notFound(`Produk tidak ditemukan (${productId}).`);

      const product = snap.data();
      if (product.aktif === false) {
        kurang.push({ productId, name: product.name, diminta: qty, tersedia: 0 });
        return;
      }

      const tersedia = stokTersedia(product);
      if (tersedia < qty) {
        kurang.push({ productId, name: product.name, diminta: qty, tersedia });
        return;
      }

      lines.push({
        productId,
        name: product.name,
        sku: product.sku ?? null,
        // Harga di-snapshot sama seperti pada transaksi kasir, supaya
        // pesanan tidak berubah nilainya bila admin mengubah harga
        // sebelum pembeli membayar.
        hargaJual: Number(product.hargaJual) || 0,
        hargaModal: Number(product.hargaModal) || 0,
        qty
      });
    });

    if (kurang.length > 0) {
      const ringkas = kurang.map((k) => `${k.name} (minta ${k.diminta}, tersedia ${k.tersedia})`).join("; ");
      throw conflict(`Stok tidak mencukupi: ${ringkas}.`, "INSUFFICIENT_STOCK", { kurang });
    }

    snaps.forEach((_, i) => {
      tx.update(refs[i], {
        stokDipesan: admin.firestore.FieldValue.increment(daftar[i].qty),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return lines;
  });
}

/**
 * Melepas kunci stok tanpa mengurangi stok fisik.
 * Dipakai saat pesanan dibatalkan atau kedaluwarsa — barangnya kembali
 * boleh dijual siapa pun.
 *
 * @param {Array<{productId:string, qty:number}>} items
 * @returns {Promise<void>}
 */
export async function lepasKunci(items) {
  await ubahKunci(items, { kurangiFisik: false });
}

/**
 * Menyelesaikan pesanan: barang benar-benar keluar dari toko.
 * Stok fisik DAN kunci sama-sama berkurang.
 *
 * @param {Array<{productId:string, qty:number}>} items
 * @returns {Promise<void>}
 */
export async function selesaikanKunci(items) {
  await ubahKunci(items, { kurangiFisik: true });
}

/**
 * Inti bersama untuk melepas dan menyelesaikan kunci.
 *
 * Nilai kunci dijaga tidak pernah negatif. Pelepasan ganda — misalnya
 * pesanan dibatalkan dua kali karena tombol diklik berulang — jauh lebih
 * mungkin terjadi daripada kelihatannya, dan tanpa penjagaan ini stokDipesan
 * akan menjadi minus lalu membuat stok tersedia terlihat lebih banyak
 * daripada isi rak yang sebenarnya.
 *
 * @param {Array<{productId:string, qty:number}>} items
 * @param {{kurangiFisik:boolean}} opsi
 */
async function ubahKunci(items, { kurangiFisik }) {
  const daftar = requireCartItems(items);
  const db = getDb();
  const refs = daftar.map((i) => db.collection("products").doc(i.productId));

  await db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...refs);

    snaps.forEach((snap, i) => {
      if (!snap.exists) return;   // produk terlanjur dihapus: tidak ada yang perlu dilepas

      const product = snap.data();
      const qty = daftar[i].qty;
      const kunciSekarang = Math.max(0, Number(product.stokDipesan) || 0);
      const kunciBaru = Math.max(0, kunciSekarang - qty);

      const patch = {
        stokDipesan: kunciBaru,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (kurangiFisik) {
        const fisik = Math.max(0, Number(product.stok) || 0);
        patch.stok = Math.max(0, fisik - qty);
      }

      tx.update(refs[i], patch);
    });
  });
}
