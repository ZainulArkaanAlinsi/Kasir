/**
 * Validasi input. Prinsip: jangan pernah percaya apa pun dari browser.
 * Setiap fungsi melempar AppError agar pesan gagalnya konsisten dan aman.
 */
import { badRequest } from "./errors.js";

/**
 * @param {unknown} value
 * @param {string} field nama field untuk pesan error
 * @param {{min?:number, max?:number}} [opts]
 * @returns {string} string yang sudah di-trim
 */
export function requireString(value, field, opts = {}) {
  if (typeof value !== "string") throw badRequest(`${field} harus berupa teks.`);
  const text = value.trim();
  const min = opts.min ?? 1;
  const max = opts.max ?? 200;
  if (text.length < min) throw badRequest(`${field} minimal ${min} karakter.`);
  if (text.length > max) throw badRequest(`${field} maksimal ${max} karakter.`);
  return text;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{min?:number, max?:number, integer?:boolean}} [opts]
 * @returns {number}
 */
export function requireNumber(value, field, opts = {}) {
  const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) {
    throw badRequest(`${field} harus berupa angka.`);
  }
  if (opts.integer && !Number.isInteger(num)) throw badRequest(`${field} harus bilangan bulat.`);
  if (opts.min !== undefined && num < opts.min) throw badRequest(`${field} minimal ${opts.min}.`);
  if (opts.max !== undefined && num > opts.max) throw badRequest(`${field} maksimal ${opts.max}.`);
  return num;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {readonly string[]} allowed
 * @returns {string}
 */
export function requireEnum(value, field, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw badRequest(`${field} harus salah satu dari: ${allowed.join(", ")}.`);
  }
  return value;
}

/**
 * Validasi daftar item keranjang yang dikirim browser.
 * Sengaja HANYA mengambil productId dan qty — harga apa pun yang dikirim
 * browser diabaikan total, karena harga wajib dibaca ulang dari Firestore.
 *
 * @param {unknown} items
 * @returns {Array<{productId:string, qty:number}>}
 */
export function requireCartItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest("Keranjang tidak boleh kosong.", "EMPTY_CART");
  }
  if (items.length > 100) throw badRequest("Maksimal 100 jenis barang per transaksi.");

  const seen = new Set();
  return items.map((item, i) => {
    const productId = requireString(item?.productId, `Item ke-${i + 1}: productId`, { max: 128 });
    const qty = requireNumber(item?.qty, `Item ke-${i + 1}: qty`, { min: 1, max: 10000, integer: true });
    if (seen.has(productId)) throw badRequest("Ada produk yang sama dikirim dua kali dalam satu transaksi.", "DUPLICATE_ITEM");
    seen.add(productId);
    return { productId, qty };
  });
}

/**
 * Parsing rentang tanggal untuk laporan.
 * @param {unknown} from ISO string
 * @param {unknown} to ISO string
 * @returns {{from:Date, to:Date}}
 */
export function requireDateRange(from, to) {
  const start = new Date(String(from));
  const end = new Date(String(to));
  if (Number.isNaN(start.getTime())) throw badRequest("Tanggal mulai tidak valid.");
  if (Number.isNaN(end.getTime())) throw badRequest("Tanggal akhir tidak valid.");
  if (start > end) throw badRequest("Tanggal mulai tidak boleh setelah tanggal akhir.");
  const maxDays = 366;
  if ((end - start) / 86400000 > maxDays) throw badRequest(`Rentang laporan maksimal ${maxDays} hari.`);
  return { from: start, to: end };
}
