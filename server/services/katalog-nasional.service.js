/**
 * Pencarian produk ke katalog produk Indonesia (api-product-indonesia).
 *
 * Inilah yang membuat scan barcode benar-benar berguna di warung. Sebelumnya,
 * memindai barang yang belum terdaftar hanya menghasilkan penolakan dan kasir
 * harus mengetik nama serta barcodenya sendiri. Sekarang barcode yang tidak
 * dikenal dicari ke katalog nasional berisi puluhan ribu produk, lalu nama dan
 * kodenya diisikan otomatis ke formulir tambah produk.
 *
 * Yang TIDAK diambil dari sana:
 *  - Harga. Dokumentasi sumbernya menyatakan sendiri harganya angka acak.
 *    Memakainya sebagai harga jual akan membuat toko menjual rugi tanpa sadar,
 *    jadi harga tetap wajib diisi admin.
 *  - Stok. Tidak ada di sumber, dan memang tidak mungkin diketahui dari luar.
 *
 * Sumber: https://github.com/ariph007/api-product-indonesia (gratis, tanpa
 * autentikasi). Bila layanannya sedang mati, pencarian gagal dengan tenang dan
 * kasir tetap bisa mengetik manual seperti sebelumnya.
 */
import { AppError } from "../lib/errors.js";
import { requireString } from "../lib/validate.js";

const BASIS = process.env.KATALOG_NASIONAL_URL
  || "https://api-products.alpha-projects.cloud/api/v1";

/** Batas tunggu. Kasir sedang melayani antrean; menunggu lama lebih buruk
 *  daripada gagal cepat lalu mengetik manual. */
const BATAS_MS = 6000;

/**
 * Membersihkan satu entri dari katalog nasional.
 * Sengaja hanya mengambil field yang dipercaya.
 *
 * @param {object} p
 * @returns {{barcode:string|null, name:string, uom:string|null}}
 */
function bersihkan(p) {
  return {
    barcode: p?.barcode ? String(p.barcode).slice(0, 64) : null,
    name: String(p?.name ?? "").slice(0, 120),
    uom: p?.uom ? String(p.uom).slice(0, 16) : null
  };
}

/**
 * @param {string} path
 * @returns {Promise<*>}
 * @throws {AppError} 502 bila sumber tidak bisa dihubungi
 */
async function ambil(path) {
  let respons;
  try {
    respons = await fetch(`${BASIS}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(BATAS_MS)
    });
  } catch {
    throw new AppError(502, "Katalog produk nasional sedang tidak bisa dihubungi.", "KATALOG_UNREACHABLE");
  }
  if (respons.status === 404) return null;
  if (!respons.ok) {
    throw new AppError(502, `Katalog nasional menjawab ${respons.status}.`, "KATALOG_ERROR");
  }
  return respons.json().catch(() => null);
}

/**
 * Mencari satu produk berdasarkan barcode.
 *
 * @param {string} barcode
 * @returns {Promise<{barcode:string|null, name:string, uom:string|null}|null>}
 *          null bila barcode tidak terdaftar di katalog nasional
 */
export async function cariBarcode(barcode) {
  const kode = requireString(barcode, "Barcode", { min: 4, max: 64 });
  const data = await ambil(`/products-barcode?barcode=${encodeURIComponent(kode)}&generateBarcode=false`);

  // Sumber bisa menjawab objek kosong, bukan 404, saat barcode tidak ditemukan.
  if (!data || !data.name) return null;
  return bersihkan(data);
}

/**
 * Mencari produk berdasarkan nama.
 *
 * @param {string} nama
 * @param {number} [batas]
 * @returns {Promise<Array<{barcode:string|null, name:string, uom:string|null}>>}
 */
export async function cariNama(nama, batas = 15) {
  const teks = requireString(nama, "Nama produk", { min: 2, max: 80 });
  const data = await ambil(`/products?name=${encodeURIComponent(teks)}`);

  if (!Array.isArray(data)) return [];
  return data.slice(0, batas).map(bersihkan).filter((p) => p.name);
}
