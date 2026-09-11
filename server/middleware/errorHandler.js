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

  // Badan permintaan yang rusak adalah kesalahan pengirim, bukan kegagalan
  // server. body-parser menandainya dengan expose:true dan status 4xx; tanpa
  // cabang ini setiap JSON salah ketik akan terlihat sebagai error internal
  // dan memenuhi log dengan kebisingan yang menyesatkan saat menelusuri bug.
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Format JSON tidak valid.", code: "BAD_JSON" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Data yang dikirim terlalu besar.", code: "PAYLOAD_TOO_LARGE" });
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
