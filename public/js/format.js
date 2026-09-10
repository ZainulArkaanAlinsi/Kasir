/** Utilitas format tampilan. Murni presentasi, tanpa logika bisnis. */

const RUPIAH = new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0
});

/** @param {number} n @returns {string} contoh: "Rp20.535" */
export const money = (n) => RUPIAH.format(Number(n) || 0);

/** @param {number} n @returns {string} contoh: "1.250" */
export const angka = (n) => new Intl.NumberFormat("id-ID").format(Number(n) || 0);

/** @param {string|Date} value @returns {string} */
export const tanggal = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
};

/** @param {string} value ISO date @returns {string} contoh "10 Sep" */
export const tanggalPendek = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
};

/**
 * Meng-escape teks sebelum dimasukkan ke innerHTML.
 * Wajib dipakai untuk SEMUA data yang berasal dari pengguna (nama produk,
 * catatan, nama kasir) agar nama seperti `<img onerror=...>` tidak
 * dieksekusi sebagai HTML — pertahanan XSS paling dasar.
 * @param {unknown} value
 * @returns {string}
 */
export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

/** Label metode bayar untuk ditampilkan. */
export const labelMetode = (m) => ({ cash: "Tunai", card: "Kartu", qris: "QRIS" }[m] ?? m ?? "-");
