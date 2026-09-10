/**
 * Error aplikasi yang AMAN dikirim ke klien.
 *
 * Aturan: hanya AppError yang pesannya boleh sampai ke pengguna. Error lain
 * (bug, kegagalan Firestore, dsb) diganti pesan generik oleh errorHandler
 * supaya stack trace dan detail internal tidak bocor ke browser.
 */
export class AppError extends Error {
  /**
   * @param {number} status kode HTTP
   * @param {string} message pesan untuk pengguna (bahasa Indonesia)
   * @param {string} [code] kode mesin, agar frontend bisa bereaksi spesifik
   * @param {object} [details] data tambahan aman, mis. daftar stok kurang
   */
  constructor(status, message, code = "APP_ERROR", details = undefined) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (msg, code = "BAD_REQUEST", details) => new AppError(400, msg, code, details);
export const unauthorized = (msg = "Token autentikasi diperlukan.") => new AppError(401, msg, "UNAUTHORIZED");
export const forbidden = (msg = "Anda tidak memiliki akses untuk aksi ini.") => new AppError(403, msg, "FORBIDDEN");
export const notFound = (msg = "Data tidak ditemukan.") => new AppError(404, msg, "NOT_FOUND");
export const conflict = (msg, code = "CONFLICT", details) => new AppError(409, msg, code, details);
