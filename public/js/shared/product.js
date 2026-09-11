/**
 * Aturan bisnis produk yang dipakai bersama oleh server dan browser.
 *
 * Sebelumnya ambang "stok menipis" ditulis sebagai angka 8 langsung di tiga
 * tempat berbeda di app.js. Akibatnya mengubah kebijakan stok berarti
 * berburu angka ajaib di seluruh berkas — dan pasti ada yang terlewat.
 * Sekarang ambangnya menjadi properti per produk, dengan satu fungsi
 * penilai di sini.
 *
 * M8 menambahkan pemisahan stok fisik dan stok yang boleh dijual. Begitu
 * toko punya dua pintu penjualan (kasir di toko dan etalase online), angka
 * `stok` saja tidak cukup: satu barang terakhir bisa dipesan pembeli online
 * pada detik yang sama saat kasir menjualnya di depan. Yang dipesan tapi
 * belum diambil dicatat terpisah di `stokDipesan`, dan kedua kanal sama-sama
 * memutuskan berdasarkan selisihnya.
 */

/** Ambang default bila produk lama belum punya field stokMinimum. */
export const STOK_MINIMUM_DEFAULT = 5;

/**
 * Jumlah unit yang benar-benar ada di rak, termasuk yang sudah dipesan
 * orang lain tapi belum diambil.
 *
 * @param {{stok?:number}} product
 * @returns {number}
 */
export function stokFisik(product) {
  return Math.max(0, Number(product?.stok) || 0);
}

/**
 * Jumlah unit yang sudah dikunci untuk pesanan online yang belum selesai.
 * @param {{stokDipesan?:number}} product
 * @returns {number}
 */
export function stokDipesan(product) {
  return Math.max(0, Number(product?.stokDipesan) || 0);
}

/**
 * Jumlah unit yang MASIH BOLEH DIJUAL, baik oleh kasir maupun etalase.
 *
 * Ini angka yang harus dipakai setiap kali sistem memutuskan "cukup atau
 * tidak". Memakai `stok` mentah akan menjual barang yang sebetulnya sudah
 * disisihkan untuk pesanan orang lain.
 *
 * @param {{stok?:number, stokDipesan?:number}} product
 * @returns {number}
 */
export function stokTersedia(product) {
  return Math.max(0, stokFisik(product) - stokDipesan(product));
}

/**
 * Apakah produk sudah masuk kategori "stok menipis"?
 * Dinilai dari stok yang tersedia, bukan stok fisik — barang yang sudah
 * dipesan orang lain tidak bisa dijual lagi, jadi tidak layak dihitung aman.
 *
 * @param {{stok?:number, stokDipesan?:number, stokMinimum?:number}} product
 * @returns {boolean}
 */
export function isLowStock(product) {
  const minimum = Number(product?.stokMinimum ?? STOK_MINIMUM_DEFAULT);
  return stokTersedia(product) <= minimum;
}

/**
 * Status stok untuk ditampilkan sebagai badge.
 * @param {{stok?:number, stokDipesan?:number, stokMinimum?:number}} product
 * @returns {{label:string, tone:"habis"|"menipis"|"aman"}}
 */
export function stockStatus(product) {
  const tersedia = stokTersedia(product);
  if (tersedia <= 0) return { label: "Habis", tone: "habis" };
  if (isLowStock(product)) return { label: "Menipis", tone: "menipis" };
  return { label: "Aman", tone: "aman" };
}
