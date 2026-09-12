/**
 * Ubin produk: warna dan monogram.
 *
 * Katalog toko kelontong jarang punya foto untuk semua barang. Alih-alih
 * membiarkan kotak abu-abu kosong, tiap produk mendapat ubin bergradasi
 * dengan monogram namanya. Warnanya ditentukan kategori, jadi barang
 * sejenis terlihat sekeluarga di grid — dan tetap sama setiap kali
 * digambar ulang, bukan diacak.
 */

/** Gradasi per kategori, mengikuti palet pada kanvas desain. */
const GRADASI = [
  "linear-gradient(150deg,#DDCDBA,#D18166)",   // pasir → terakota
  "linear-gradient(150deg,#D5E3E5,#5C6D93)",   // mint → slate
  "linear-gradient(150deg,#e8a58d,#D18166)",   // terakota muda → terakota
  "linear-gradient(150deg,#b9c6cd,#5C6D93)"    // biru kabut → slate
];

/** Kategori yang sudah dikenal dipetakan tetap, supaya tidak berpindah warna. */
const TETAP = {
  makanan: GRADASI[0],
  minuman: GRADASI[1],
  snack: GRADASI[2],
  rumah: GRADASI[3]
};

/**
 * Warna ubin untuk sebuah kategori.
 * Kategori di luar daftar tetap di-hash agar hasilnya konsisten antar render.
 *
 * @param {string} [category]
 * @returns {string} nilai CSS background
 */
export function tileBg(category) {
  const kunci = String(category ?? "").trim().toLowerCase();
  if (TETAP[kunci]) return TETAP[kunci];

  let hash = 0;
  for (const ch of kunci) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return GRADASI[hash % GRADASI.length];
}

/**
 * Monogram nama produk: maksimal dua huruf.
 * @param {string} [name]
 * @returns {string}
 */
export function initials(name) {
  const kata = String(name ?? "?").trim().split(/\s+/).slice(0, 2);
  const huruf = kata.map((w) => w[0] ?? "").join("");
  return (huruf || "?").toUpperCase();
}

/** Kelas titik indikator stok pada chip kartu produk. */
export const dotClass = (tone) => `dot-${tone}`;

/** Kelas badge stok (dipakai tabel & daftar). */
export const badgeClass = (tone) => (tone === "aman" ? "" : tone === "habis" ? "out-badge" : "low-badge");
