/**
 * Impor produk contoh dari DummyJSON.
 *
 * Gunanya untuk menguji aplikasi tanpa mengetik puluhan produk satu per satu,
 * dan sekaligus menyelesaikan satu kekurangan lama: DummyJSON menyediakan URL
 * foto sungguhan, jadi katalog akhirnya berisi gambar barang, bukan monogram
 * huruf.
 *
 * Dijalankan di server, bukan di browser. Dua alasannya:
 *  - Penulisan produk memang hanya boleh lewat server; membiarkan browser
 *    menulis langsung akan membatalkan seluruh penjagaan stok dan harga.
 *  - Konversi harga dan penentuan harga modal harus sama persis untuk semua
 *    pemanggil. Bila dihitung di browser, dua perangkat bisa menghasilkan
 *    angka berbeda untuk produk yang sama.
 */
import { getDb, admin } from "./firebase.js";
import { AppError, badRequest } from "../lib/errors.js";
import { requireNumber } from "../lib/validate.js";

const SUMBER = "https://dummyjson.com/products";

/**
 * Pengali harga. DummyJSON memakai angka dolar kecil seperti 9.99, yang
 * terlihat janggal sebagai rupiah. Dikali 1000 lalu dibulatkan ke ratusan
 * supaya angkanya wajar untuk data uji.
 *
 * Ini BUKAN kurs. Jangan dipakai untuk apa pun selain data contoh.
 */
const PENGALI_RUPIAH = 1000;

/**
 * Marjin yang diasumsikan untuk menurunkan harga modal.
 *
 * DummyJSON tidak punya harga pokok, padahal seluruh laporan laba KasirOne
 * bergantung padanya. Daripada mengisi nol — yang akan membuat laba terlihat
 * sama dengan omzet dan menyesatkan pemilik toko — harga modal diturunkan
 * dari harga jual memakai marjin tetap yang wajar untuk ritel kecil.
 */
const MARJIN_ASUMSI = 0.28;

/** Membulatkan ke ratusan rupiah terdekat. */
const keRatusan = (n) => Math.max(100, Math.round(n / 100) * 100);

/**
 * Mengubah satu produk DummyJSON menjadi bentuk produk KasirOne.
 *
 * @param {object} p produk mentah dari DummyJSON
 * @returns {object} dokumen produk siap simpan
 */
export function petakanProduk(p) {
  const hargaJual = keRatusan((Number(p.price) || 1) * PENGALI_RUPIAH);
  const hargaModal = keRatusan(hargaJual * (1 - MARJIN_ASUMSI));
  const stok = Math.max(0, Number(p.stock) || 0);

  return {
    name: String(p.title ?? "Tanpa nama").slice(0, 120),
    // SKU DummyJSON sudah unik; bila kosong dibuat dari id supaya scan barcode
    // tetap punya nilai yang bisa dicari.
    sku: String(p.sku || `DJ-${p.id}`).slice(0, 64),
    category: String(p.category ?? "Umum").slice(0, 60),
    hargaJual,
    hargaModal,
    stok,
    // Ambang menipis diturunkan dari stoknya sendiri supaya tidak semua produk
    // langsung berstatus "aman" atau semuanya "menipis".
    stokMinimum: Math.max(3, Math.round(stok * 0.15)),
    imageUrl: typeof p.thumbnail === "string" && p.thumbnail.startsWith("https://") ? p.thumbnail : null,
    stokDipesan: 0,
    aktif: true
  };
}

/**
 * Mengambil produk dari DummyJSON lalu menyimpannya ke Firestore.
 *
 * Produk lama TIDAK dihapus. Menghapus katalog yang sedang dipakai hanya
 * karena seseorang menekan tombol impor adalah kejutan yang mahal; yang
 * ber-SKU sama diperbarui, sisanya ditambahkan.
 *
 * @param {{limit?:number, adminUid:string}} input
 * @returns {Promise<{diambil:number, baru:number, diperbarui:number}>}
 * @throws {AppError} 502 bila sumber tidak bisa dihubungi
 */
export async function imporDariDummyJson({ limit = 30, adminUid }) {
  const jumlah = requireNumber(limit, "Jumlah produk", { min: 1, max: 100, integer: true });

  let respons;
  try {
    respons = await fetch(`${SUMBER}?limit=${jumlah}&select=title,sku,category,price,stock,thumbnail`, {
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw new AppError(502, "Tidak bisa menghubungi DummyJSON. Periksa koneksi internet.", "SOURCE_UNREACHABLE");
  }
  if (!respons.ok) {
    throw new AppError(502, `DummyJSON menjawab ${respons.status}.`, "SOURCE_ERROR");
  }

  const data = await respons.json().catch(() => null);
  const mentah = data?.products;
  if (!Array.isArray(mentah) || mentah.length === 0) {
    throw badRequest("DummyJSON tidak mengembalikan produk.", "EMPTY_SOURCE");
  }

  const db = getDb();
  const adaSnap = await db.collection("products").get();
  const skuKeId = new Map(adaSnap.docs.map((d) => [d.data().sku, d.id]));

  let baru = 0;
  let diperbarui = 0;

  // Firestore membatasi 500 operasi per batch; 100 produk masih jauh di bawah,
  // tetapi batch tetap dipakai supaya seluruh impor berhasil atau gagal utuh.
  const batch = db.batch();
  const sekarang = admin.firestore.FieldValue.serverTimestamp();

  for (const p of mentah) {
    const produk = petakanProduk(p);
    const idLama = skuKeId.get(produk.sku);

    if (idLama) {
      // Stok dan kunci pesanan yang sedang berjalan TIDAK ditimpa. Menimpanya
      // akan menghapus jejak barang yang sudah dipesan orang.
      const { stok, stokDipesan, ...tanpaStok } = produk;
      batch.update(db.collection("products").doc(idLama), { ...tanpaStok, updatedAt: sekarang });
      diperbarui += 1;
    } else {
      batch.set(db.collection("products").doc(), {
        ...produk,
        createdBy: adminUid,
        createdAt: sekarang,
        updatedAt: sekarang
      });
      baru += 1;
    }
  }

  await batch.commit();
  return { diambil: mentah.length, baru, diperbarui };
}
