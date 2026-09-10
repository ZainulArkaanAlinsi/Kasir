/**
 * Perhitungan uang — SATU-SATUNYA sumber kebenaran.
 *
 * Modul ini sengaja bebas dari DOM maupun Firebase supaya bisa diimpor
 * oleh browser DAN oleh server Node. Server wajib menghitung ulang total
 * dengan fungsi yang sama persis, lalu membandingkannya dengan angka yang
 * dikirim browser. Kalau logikanya diduplikasi, keduanya pasti akan
 * menyimpang cepat atau lambat (dan itu sudah pernah terjadi di repo ini:
 * renderCart() dan totalCart() dulu menghitung sendiri-sendiri, sehingga
 * diskon hilang saat penagihan).
 *
 * Semua nilai uang adalah bilangan bulat rupiah. Tidak ada sen.
 */

/** Tarif PPN default. Bisa ditimpa lewat argumen agar mudah diuji. */
export const DEFAULT_TAX_RATE = 0.11;

/**
 * Membulatkan ke rupiah utuh.
 * Math.round dipakai (bukan floor/ceil) supaya pembulatan tidak sistematis
 * merugikan salah satu pihak.
 *
 * @param {number} value
 * @returns {number} rupiah bulat, minimal 0
 */
export function toRupiah(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

/**
 * Menghitung total satu baris keranjang.
 *
 * @param {{hargaJual:number, qty:number}} line
 * @returns {number} subtotal baris
 */
export function lineSubtotal(line) {
  const price = Number(line?.hargaJual);
  const qty = Number(line?.qty);
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return 0;
  if (price < 0 || qty <= 0) return 0;
  return toRupiah(price * qty);
}

/**
 * Menghitung seluruh angka transaksi dari daftar baris keranjang.
 *
 * Urutan perhitungan penting dan disepakati: diskon dipotong dari subtotal
 * LEBIH DULU, baru pajak dikenakan atas nilai setelah diskon. Kalau urutannya
 * dibalik, pelanggan membayar pajak atas uang yang tidak pernah ia bayar.
 *
 * @param {Array<{hargaJual:number, qty:number}>} lines
 * @param {{discount?:number, taxRate?:number}} [options]
 * @returns {{subtotal:number, discount:number, tax:number, total:number}}
 */
export function computeTotals(lines, options = {}) {
  const list = Array.isArray(lines) ? lines : [];
  const taxRate = Number.isFinite(options.taxRate) ? options.taxRate : DEFAULT_TAX_RATE;

  const subtotal = toRupiah(list.reduce((sum, line) => sum + lineSubtotal(line), 0));

  // Diskon tidak boleh melebihi subtotal, jika tidak total bisa negatif.
  const discount = Math.min(toRupiah(options.discount ?? 0), subtotal);

  const taxable = subtotal - discount;
  const tax = toRupiah(taxable * taxRate);

  return { subtotal, discount, tax, total: taxable + tax };
}

/**
 * Menghitung kembalian untuk pembayaran tunai.
 *
 * @param {number} received uang yang diterima kasir
 * @param {number} total tagihan
 * @returns {{sufficient:boolean, change:number}} change 0 bila uang kurang
 */
export function computeChange(received, total) {
  const paid = toRupiah(received);
  const bill = toRupiah(total);
  if (paid < bill) return { sufficient: false, change: 0 };
  return { sufficient: true, change: paid - bill };
}

/**
 * Laba kotor satu baris = (harga jual - harga modal) x qty.
 * Dihitung dari snapshot harga di transaksi, bukan dari master produk,
 * supaya laporan historis tetap benar walau harga produk berubah nanti.
 *
 * @param {{hargaJual:number, hargaModal:number, qty:number}} line
 * @returns {number} boleh negatif bila barang dijual rugi
 */
export function lineProfit(line) {
  const sell = Number(line?.hargaJual) || 0;
  const cost = Number(line?.hargaModal) || 0;
  const qty = Number(line?.qty) || 0;
  return Math.round((sell - cost) * qty);
}
