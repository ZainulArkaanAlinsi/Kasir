/**
 * Aturan bisnis produk yang dipakai bersama oleh server dan browser.
 *
 * Sebelumnya ambang "stok menipis" ditulis sebagai angka 8 langsung di tiga
 * tempat berbeda di app.js. Akibatnya mengubah kebijakan stok berarti
 * berburu angka ajaib di seluruh berkas — dan pasti ada yang terlewat.
 * Sekarang ambangnya menjadi properti per produk, dengan satu fungsi
 * penilai di sini.
 */

/** Ambang default bila produk lama belum punya field stokMinimum. */
export const STOK_MINIMUM_DEFAULT = 5;

/**
 * Apakah produk sudah masuk kategori "stok menipis"?
 * @param {{stok:number, stokMinimum?:number}} product
 * @returns {boolean}
 */
export function isLowStock(product) {
  const stok = Number(product?.stok) || 0;
  const minimum = Number(product?.stokMinimum ?? STOK_MINIMUM_DEFAULT);
  return stok <= minimum;
}

/**
 * Status stok untuk ditampilkan sebagai badge.
 * @param {{stok:number, stokMinimum?:number}} product
 * @returns {{label:string, tone:"habis"|"menipis"|"aman"}}
 */
export function stockStatus(product) {
  const stok = Number(product?.stok) || 0;
  if (stok <= 0) return { label: "Habis", tone: "habis" };
  if (isLowStock(product)) return { label: "Menipis", tone: "menipis" };
  return { label: "Aman", tone: "aman" };
}
