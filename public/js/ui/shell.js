/**
 * Utilitas antarmuka dasar: pemilih elemen, toast, modal, dan navigasi
 * halaman. Dipisah agar modul fitur tidak masing-masing menulis ulang
 * helper yang sama (DRY).
 */

/** @param {string} id @returns {HTMLElement|null} */
export const $ = (id) => document.getElementById(id);

/** @param {string} selector @returns {NodeListOf<Element>} */
export const $$ = (selector) => document.querySelectorAll(selector);

let toastTimer = null;

/**
 * Menampilkan notifikasi singkat.
 * @param {string} message
 * @param {"info"|"error"|"success"} [tone]
 */
export function showToast(message, tone = "info") {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

/** @param {string} id */
export const openModal = (id) => $(id)?.classList.remove("hidden");

/** @param {string} id */
export const closeModal = (id) => $(id)?.classList.add("hidden");

/** Menutup semua modal yang sedang terbuka. */
export const closeAllModals = () => $$(".modal:not(.hidden)").forEach((m) => m.classList.add("hidden"));

/**
 * Menampilkan pesan error dari API secara konsisten.
 * Semua error API punya bentuk sama (message + code), baik dari server
 * maupun dari mode demo, sehingga penanganannya cukup satu tempat.
 * @param {Error & {code?:string}} error
 */
export function showApiError(error) {
  console.error("[api]", error);
  showToast(error?.message || "Terjadi kesalahan. Coba lagi.", "error");
}

/**
 * Menjalankan aksi async sambil menonaktifkan tombol pemicunya,
 * mencegah double-submit (mis. transaksi terkirim dua kali).
 * @param {HTMLButtonElement|null} button
 * @param {() => Promise<*>} action
 */
export async function withBusy(button, action) {
  if (button) button.disabled = true;
  try {
    return await action();
  } finally {
    if (button) button.disabled = false;
  }
}
