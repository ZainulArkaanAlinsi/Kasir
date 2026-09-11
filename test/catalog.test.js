/**
 * Uji penyaringan katalog publik (M10).
 *
 * Etalase dibuka tanpa login, jadi apa pun yang lolos dari sini bisa dibaca
 * siapa saja — termasuk pesaing sebelah. Yang paling berbahaya adalah
 * `hargaModal`: kalau bocor, orang tahu persis berapa margin toko dan berapa
 * toko membeli dari grosir.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { untukPublik } from "../server/routes/catalog.routes.js";

/** Produk lengkap seperti tersimpan di Firestore. */
const PRODUK = {
  id: "p1",
  name: "Top Kopi Aren",
  sku: "8998866200073",
  category: "Minuman",
  hargaJual: 6500,
  hargaModal: 4800,          // RAHASIA TOKO
  stok: 40,
  stokDipesan: 5,
  stokMinimum: 15,
  imageUrl: "data:image/jpeg;base64,AAAA",
  aktif: true,
  createdBy: "admin-1"       // identitas staf, bukan urusan pembeli
};

test("harga modal TIDAK PERNAH ikut ke publik", () => {
  const hasil = untukPublik(PRODUK);
  assert.equal(hasil.hargaModal, undefined);
  assert.ok(!("hargaModal" in hasil), "kunci hargaModal tidak boleh ada sama sekali");
  assert.ok(!JSON.stringify(hasil).includes("4800"), "nilainya pun tidak boleh muncul di mana pun");
});

test("stok mentah dan kunci pesanan tidak dibocorkan", () => {
  const hasil = untukPublik(PRODUK);
  assert.ok(!("stok" in hasil), "berapa isi rak sebenarnya bukan urusan pembeli");
  assert.ok(!("stokDipesan" in hasil), "berapa yang dikunci orang lain juga bukan");
  assert.ok(!("stokMinimum" in hasil), "kebijakan restock toko tidak perlu terlihat");
  assert.ok(!("createdBy" in hasil), "identitas staf tidak dibagikan");
});

test("yang dikirim hanya tujuh field yang memang dibutuhkan etalase", () => {
  const kunci = Object.keys(untukPublik(PRODUK)).sort();
  assert.deepEqual(kunci, ["category", "habis", "hargaJual", "id", "imageUrl", "name", "sku", "tersedia"]);
});

test("tersedia dihitung dari stok dikurangi yang sudah dipesan", () => {
  assert.equal(untukPublik(PRODUK).tersedia, 35);
  assert.equal(untukPublik(PRODUK).habis, false);
});

test("barang yang seluruh sisanya sudah dipesan ditandai habis", () => {
  const hasil = untukPublik({ ...PRODUK, stok: 5, stokDipesan: 5 });
  assert.equal(hasil.tersedia, 0);
  assert.equal(hasil.habis, true, "etalase harus menolak memesan barang ini");
});

test("tersedia tidak pernah negatif walau data ganjil", () => {
  assert.equal(untukPublik({ ...PRODUK, stok: 2, stokDipesan: 99 }).tersedia, 0);
  assert.equal(untukPublik({ ...PRODUK, stok: undefined, stokDipesan: undefined }).tersedia, 0);
});

test("produk tanpa foto tetap aman diproses", () => {
  const hasil = untukPublik({ id: "x", name: "Tanpa Foto", hargaJual: 1000 });
  assert.equal(hasil.imageUrl, null);
  assert.equal(hasil.sku, null);
  assert.equal(hasil.category, null);
});
