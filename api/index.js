/**
 * Titik masuk untuk Vercel.
 *
 * Vercel menjalankan berkas ini sebagai serverless function, bukan sebagai
 * proses server yang hidup terus. Karena itu aplikasinya hanya diekspor,
 * tidak memanggil listen — Vercel yang mengurus soket dan daur hidupnya.
 * server/server.js sendiri sudah melewati listen bila variabel VERCEL ada.
 */
import { app } from "../server/server.js";

export default app;
