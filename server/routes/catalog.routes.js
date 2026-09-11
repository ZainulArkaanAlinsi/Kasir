/**
 * Katalog publik untuk etalase (M10).
 *
 * Sengaja DIPISAH dari /api/products, bukan sekadar dibuka aksesnya.
 * Dokumen produk berisi `hargaModal` — berapa toko membelinya dari grosir.
 * Kalau pembeli bisa melihat angka itu, ia tahu persis berapa margin toko,
 * dan pesaing sebelah tinggal membuka halaman ini untuk menyalin struktur
 * harga. Firestore tidak bisa menyembunyikan sebagian field, jadi penyaringan
 * harus terjadi di server, dan etalase tidak boleh memakai SDK langsung.
 *
 * Yang juga tidak dikirim: stok mentah. Pembeli cukup tahu "tersedia berapa",
 * bukan berapa yang sedang dikunci pesanan orang lain.
 */
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { listProducts, findProductBySku } from "../services/product.service.js";
import { stokTersedia } from "../../public/js/shared/product.js";

export const catalogRouter = Router();

/**
 * Menyaring dokumen produk menjadi bentuk yang aman dilihat publik.
 *
 * @param {object} p dokumen produk lengkap
 * @returns {{id:string, name:string, sku:string|null, category:string|null,
 *            hargaJual:number, imageUrl:string|null, tersedia:number, habis:boolean}}
 */
export function untukPublik(p) {
  const tersedia = stokTersedia(p);
  return {
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    category: p.category ?? null,
    hargaJual: Number(p.hargaJual) || 0,
    imageUrl: p.imageUrl ?? null,
    tersedia,
    habis: tersedia <= 0
  };
}

/** Seluruh produk yang masih dijual. */
catalogRouter.get("/", asyncHandler(async (_req, res) => {
  const semua = await listProducts();
  res.json({ data: semua.filter((p) => p.aktif !== false).map(untukPublik) });
}));

/** Kategori yang tersedia, untuk tombol saringan di etalase. */
catalogRouter.get("/kategori", asyncHandler(async (_req, res) => {
  const semua = await listProducts();
  const kategori = [...new Set(semua.filter((p) => p.aktif !== false).map((p) => p.category).filter(Boolean))];
  res.json({ data: kategori.sort() });
}));

/** Satu produk berdasarkan id. */
catalogRouter.get("/:id", asyncHandler(async (req, res) => {
  const semua = await listProducts();
  const produk = semua.find((p) => p.id === req.params.id && p.aktif !== false);
  if (!produk) return res.status(404).json({ error: "Produk tidak ditemukan.", code: "NOT_FOUND" });
  res.json({ data: untukPublik(produk) });
}));
