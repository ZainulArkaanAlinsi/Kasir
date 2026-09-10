/**
 * Pemilihan & pengecilan foto produk di sisi browser.
 *
 * Foto dikecilkan SEBELUM dikirim/disimpan karena kamera ponsel menghasilkan
 * berkas 3-8 MB, sedangkan kartu produk hanya menampilkannya sebesar ~200px.
 * Tanpa pengecilan, mode demo akan menabrak kuota localStorage hanya setelah
 * beberapa produk, dan mode live memboroskan bandwidth kasir.
 */

/** Batas berkas mentah yang boleh dipilih. */
export const MAKS_BYTE = 3 * 1024 * 1024;

/** Sisi terpanjang hasil pengecilan, dalam piksel. */
const SISI_MAKS = 640;

/** Mutu JPEG hasil pengecilan. 0.82 masih tajam tapi jauh lebih kecil. */
const MUTU = 0.82;

const TIPE_DIIZINKAN = ["image/jpeg", "image/png", "image/webp"];

/**
 * Membaca berkas gambar lalu mengembalikannya sebagai data URL yang sudah
 * dikecilkan dan dipotong menjadi bujur sangkar (sesuai bentuk kartu produk).
 *
 * @param {File} file berkas dari <input type="file"> atau drag-and-drop
 * @returns {Promise<string>} data URL JPEG
 * @throws {Error} bila tipe tidak didukung, terlalu besar, atau gagal dibaca
 */
export async function bacaGambar(file) {
  if (!file) throw new Error("Tidak ada berkas yang dipilih.");
  if (!TIPE_DIIZINKAN.includes(file.type)) {
    throw new Error("Format harus JPG, PNG, atau WebP.");
  }
  if (file.size > MAKS_BYTE) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`Ukuran foto ${mb} MB, melebihi batas 3 MB.`);
  }

  const bitmap = await muatBitmap(file);
  return potongBujurSangkar(bitmap);
}

/**
 * Memuat berkas menjadi objek gambar.
 * createImageBitmap dipakai bila tersedia karena jauh lebih cepat; <img>
 * dipakai sebagai cadangan untuk peramban yang belum mendukungnya.
 *
 * @param {File} file
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
async function muatBitmap(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Jatuh ke cadangan di bawah.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Berkas tidak bisa dibaca sebagai gambar."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Memotong bagian tengah gambar menjadi bujur sangkar lalu mengecilkannya.
 * Dipotong dari tengah supaya produk yang biasanya berada di tengah bingkai
 * tidak terpotong kepalanya.
 *
 * @param {ImageBitmap|HTMLImageElement} sumber
 * @returns {string} data URL JPEG
 */
function potongBujurSangkar(sumber) {
  const lebar = sumber.width;
  const tinggi = sumber.height;
  const sisi = Math.min(lebar, tinggi);
  const sx = Math.round((lebar - sisi) / 2);
  const sy = Math.round((tinggi - sisi) / 2);
  const target = Math.min(sisi, SISI_MAKS);

  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sumber, sx, sy, sisi, sisi, 0, 0, target, target);

  if (typeof sumber.close === "function") sumber.close();
  return canvas.toDataURL("image/jpeg", MUTU);
}

/**
 * Perkiraan ukuran byte sebuah data URL, untuk peringatan kuota.
 * @param {string} dataUrl
 * @returns {number}
 */
export function perkiraanByte(dataUrl) {
  if (typeof dataUrl !== "string") return 0;
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.round(base64.length * 0.75);
}
