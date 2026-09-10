/**
 * Pemindaian barcode (M2).
 *
 * Scanner USB bekerja sebagai "keyboard wedge": ia mengetik digit barcode
 * sangat cepat lalu menekan Enter. Jadi kita tidak butuh driver apa pun —
 * cukup mendengarkan ketikan global dan membedakannya dari ketikan manusia
 * berdasarkan kecepatan antar-karakter.
 */
import { showToast } from "./shell.js";

/** Jeda maksimum antar karakter (ms) agar dianggap berasal dari scanner. */
const MAX_JEDA_MS = 40;
/** Panjang minimum kode agar tidak salah menangkap ketikan biasa. */
const MIN_PANJANG = 6;

/**
 * Memasang pendengar barcode global.
 *
 * @param {(kode:string) => void} onScan dipanggil dengan kode yang terbaca
 * @returns {() => void} fungsi untuk melepas pendengar
 */
export function attachBarcodeListener(onScan) {
  let buffer = "";
  let lastTime = 0;

  /** @param {KeyboardEvent} event */
  function handler(event) {
    // Jangan bajak ketikan saat pengguna sedang mengisi form.
    const target = event.target;
    const sedangMengetik = target instanceof HTMLElement
      && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      && target.dataset.barcodeInput !== "true";
    if (sedangMengetik) return;

    const now = Date.now();
    if (now - lastTime > MAX_JEDA_MS) buffer = "";
    lastTime = now;

    if (event.key === "Enter") {
      const kode = buffer.trim();
      buffer = "";
      if (kode.length >= MIN_PANJANG) {
        event.preventDefault();
        onScan(kode);
      }
      return;
    }

    // Barcode 1D umumnya alfanumerik satu karakter per event.
    if (event.key.length === 1) buffer += event.key;
  }

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}

/**
 * Menangani hasil scan: cari produk lalu masukkan keranjang.
 *
 * @param {string} kode
 * @param {object} api
 * @param {(product:object) => boolean} tambahKeKeranjang
 */
export async function handleScan(kode, api, tambahKeKeranjang) {
  try {
    const product = await api.findBySku(kode);
    if (tambahKeKeranjang(product)) {
      showToast(`${product.name} ditambahkan.`, "success");
    }
  } catch (error) {
    // Scan gagal harus TERLIHAT. Diam-diam gagal adalah bug kasir paling
    // menyebalkan: barang sudah dipindai tapi tidak masuk keranjang.
    showToast(error?.message || `Barcode "${kode}" tidak terdaftar.`, "error");
  }
}
