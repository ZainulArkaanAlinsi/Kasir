/**
 * Penanganan error terpusat.
 *
 * Aturan keamanan: hanya AppError (error yang kita buat sendiri dan sudah
 * kita nyatakan aman) yang pesannya diteruskan ke klien. Error lain diganti
 * pesan generik agar stack trace, nama koleksi internal, atau detail
 * kredensial tidak pernah bocor ke browser.
 */
import { AppError } from "../lib/errors.js";

/** Handler 404 untuk rute /api yang tidak dikenal. */
export function notFoundHandler(req, res, next) {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Endpoint tidak ditemukan.", code: "NO_ROUTE" });
  }
  next();
}

/** @type {import("express").ErrorRequestHandler} */
export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    const body = { error: err.message, code: err.code };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }

  // Bug atau kegagalan tak terduga: catat lengkap di server, kirim generik ke klien.
  console.error("[unhandled]", err);
  res.status(500).json({ error: "Terjadi kesalahan di server.", code: "INTERNAL" });
}

/**
 * Membungkus handler async agar error-nya masuk ke errorHandler.
 * Tanpa ini, promise yang reject di Express akan menggantung tanpa respons.
 * @param {Function} fn
 * @returns {import("express").RequestHandler}
 */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
