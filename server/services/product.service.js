/**
 * Layanan master produk.
 * Menambahkan dua field yang sebelumnya tidak ada di aplikasi:
 *  - hargaModal  : harga pokok, dasar perhitungan laba
 *  - stokMinimum : ambang "stok menipis" PER PRODUK, menggantikan angka 8
 *                  yang dulu di-hardcode di tiga tempat berbeda di app.js
 */
import { getDb, admin } from "./firebase.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { requireNumber, requireString } from "../lib/validate.js";
import { isLowStock, STOK_MINIMUM_DEFAULT } from "../../public/js/shared/product.js";

/**
 * Batas panjang string foto (~500 KB base64).
 * Dokumen Firestore maksimal 1 MB; sisanya disediakan untuk field lain.
 */
const MAKS_PANJANG_FOTO = 700000;

/**
 * Memvalidasi & menormalkan payload produk.
 * @param {object} body
 * @param {boolean} partial true untuk update (field boleh sebagian)
 * @returns {object} data bersih siap simpan
 */
function normalizeProduct(body, partial = false) {
  const out = {};
  const has = (k) => body?.[k] !== undefined;

  if (!partial || has("name")) out.name = requireString(body?.name, "Nama produk", { max: 120 });
  if (!partial || has("sku")) out.sku = requireString(body?.sku, "SKU/Barcode", { max: 64 });
  if (!partial || has("category")) out.category = requireString(body?.category, "Kategori", { max: 60 });
  if (!partial || has("hargaJual")) out.hargaJual = requireNumber(body?.hargaJual, "Harga jual", { min: 0, integer: true });
  if (!partial || has("hargaModal")) out.hargaModal = requireNumber(body?.hargaModal, "Harga modal", { min: 0, integer: true });
  if (!partial || has("stok")) out.stok = requireNumber(body?.stok, "Stok", { min: 0, integer: true });
  if (!partial || has("stokMinimum")) out.stokMinimum = requireNumber(body?.stokMinimum ?? STOK_MINIMUM_DEFAULT, "Stok minimum", { min: 0, integer: true });
  if (has("aktif")) out.aktif = Boolean(body.aktif);
  if (has("imageUrl")) out.imageUrl = normalizeImage(body.imageUrl);

  // Aturan bisnis: menjual di bawah modal biasanya salah input, bukan niat.
  if (out.hargaJual !== undefined && out.hargaModal !== undefined && out.hargaJual < out.hargaModal) {
    throw badRequest("Harga jual tidak boleh lebih kecil dari harga modal.", "PRICE_BELOW_COST");
  }
  return out;
}

/**
 * Memvalidasi foto produk.
 *
 * Yang diterima hanya data URL gambar (hasil pengecilan di browser) atau URL
 * https bila toko memakai CDN sendiri. Skema lain ditolak karena string
 * seperti `javascript:` akan langsung dieksekusi begitu dipasang ke atribut
 * src pada halaman admin.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeImage(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw badRequest("Foto produk tidak valid.");

  const aman = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
    || /^https:\/\/\S+$/.test(value);
  if (!aman) throw badRequest("Foto harus gambar JPG/PNG/WebP atau tautan https.", "BAD_IMAGE");

  if (value.length > MAKS_PANJANG_FOTO) {
    throw badRequest("Foto terlalu besar. Kecilkan dulu sebelum diunggah.", "IMAGE_TOO_LARGE");
  }
  return value;
}

/** SKU wajib unik karena dipakai sebagai nilai barcode saat scan. */
async function assertSkuUnique(sku, exceptId = null) {
  const snap = await getDb().collection("products").where("sku", "==", sku).limit(2).get();
  const bentrok = snap.docs.find((d) => d.id !== exceptId);
  if (bentrok) throw conflict(`SKU "${sku}" sudah dipakai produk lain.`, "DUPLICATE_SKU");
}

/** @returns {Promise<Array<object>>} seluruh produk aktif */
export async function listProducts() {
  const snap = await getDb().collection("products").orderBy("name").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Mencari satu produk berdasarkan SKU/barcode — dipakai fitur scan.
 * @param {string} sku
 * @returns {Promise<object>}
 */
export async function findProductBySku(sku) {
  const clean = requireString(sku, "SKU", { max: 64 });
  const snap = await getDb().collection("products").where("sku", "==", clean).limit(1).get();
  if (snap.empty) throw notFound(`Barcode "${clean}" tidak terdaftar.`);
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/** @param {object} body @param {string} adminUid @returns {Promise<object>} */
export async function createProduct(body, adminUid) {
  const data = normalizeProduct(body, false);
  await assertSkuUnique(data.sku);

  const ref = getDb().collection("products").doc();
  await ref.set({
    ...data,
    imageUrl: data.imageUrl ?? null,
    aktif: data.aktif ?? true,
    createdBy: adminUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { id: ref.id, ...data };
}

/** @param {string} id @param {object} body @returns {Promise<object>} */
export async function updateProduct(id, body) {
  const ref = getDb().collection("products").doc(id);
  const current = await ref.get();
  if (!current.exists) throw notFound("Produk tidak ditemukan.");

  const data = normalizeProduct(body, true);

  // Validasi silang terhadap nilai tersimpan bila hanya salah satu harga diubah.
  const merged = { ...current.data(), ...data };
  if (Number(merged.hargaJual) < Number(merged.hargaModal)) {
    throw badRequest("Harga jual tidak boleh lebih kecil dari harga modal.", "PRICE_BELOW_COST");
  }
  if (data.sku) await assertSkuUnique(data.sku, id);

  await ref.update({ ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  return { id, ...merged, ...data };
}

/**
 * Nonaktifkan produk (soft delete).
 * Sengaja TIDAK menghapus dokumen: transaksi lama menyimpan snapshot harga,
 * tapi laporan tetap butuh nama produk yang bisa ditelusuri.
 * @param {string} id
 */
export async function deactivateProduct(id) {
  const ref = getDb().collection("products").doc(id);
  if (!(await ref.get()).exists) throw notFound("Produk tidak ditemukan.");
  await ref.update({ aktif: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  return { id, aktif: false };
}

/**
 * Ambang stok menipis dipakai bersama dengan frontend.
 * Di-re-export agar pemanggil di server tidak perlu tahu letak modul bersama.
 */
export { isLowStock, STOK_MINIMUM_DEFAULT };
