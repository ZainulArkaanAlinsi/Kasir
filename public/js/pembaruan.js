/**
 * Pembaruan otomatis.
 *
 * Tujuannya sederhana: kasir tidak pernah perlu menekan tombol "perbarui".
 * Begitu versi baru diunggah, ponsel yang sudah memasang aplikasi ini
 * berpindah ke versi itu dengan sendirinya.
 *
 * Yang tidak sederhana adalah KAPAN memuat ulang halaman. Memuat ulang di
 * tengah transaksi berarti keranjang yang sudah disusun kasir hilang —
 * padahal pembeli sedang berdiri di depan meja. Karena itu pembaruan memang
 * diambil segera, tetapi penerapannya menunggu sampai layar benar-benar
 * sedang tidak dipakai untuk sesuatu yang bisa hilang: keranjang kosong dan
 * tidak ada jendela yang terbuka.
 */

/** Jeda pemeriksaan versi baru saat aplikasi dibiarkan terbuka seharian. */
const JEDA_PERIKSA = 15 * 60 * 1000;

/** Jeda mencoba lagi ketika pembaruan siap tetapi layar sedang dipakai. */
const JEDA_COBA_LAGI = 20 * 1000;

/**
 * Mendaftarkan service worker dan mengurus pembaruannya.
 *
 * @param {object} [opsi]
 * @param {() => boolean} [opsi.aman] mengembalikan true bila halaman boleh
 *        dimuat ulang saat ini. Bawaannya selalu boleh.
 */
export function pasangPembaruanOtomatis({ aman = () => true } = {}) {
  if (!("serviceWorker" in navigator)) return;

  // Dibuka lewat berkas atau http biasa (bukan https maupun localhost):
  // service worker tidak tersedia, dan itu bukan galat — aplikasinya tetap
  // berjalan, hanya tanpa pemasangan ke layar utama.
  if (!window.isSecureContext) return;

  let sedangMuatUlang = false;

  /** Memuat ulang begitu layar aman; kalau belum, menunggu lalu mencoba lagi. */
  function muatUlangSaatAman() {
    if (sedangMuatUlang) return;

    if (!aman()) {
      setTimeout(muatUlangSaatAman, JEDA_COBA_LAGI);
      return;
    }
    sedangMuatUlang = true;
    window.location.reload();
  }

  // Service worker baru mengambil alih -> halaman masih menjalankan kode lama,
  // jadi perlu dimuat ulang agar benar-benar memakai versi baru.
  navigator.serviceWorker.addEventListener("controllerchange", muatUlangSaatAman);

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");

      // Halaman yang dibiarkan terbuka berjam-jam tidak akan pernah tahu ada
      // versi baru kalau tidak menanyakannya sendiri.
      setInterval(() => reg.update().catch(() => {}), JEDA_PERIKSA);

      // Kembali dari layar terkunci atau dari aplikasi lain adalah saat paling
      // wajar untuk memeriksa: pengguna baru kembali, belum menyentuh apa pun.
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    } catch {
      // Pendaftaran gagal (misalnya mode penyamaran): aplikasi tetap berjalan
      // normal, hanya tanpa mode luring dan tanpa pemasangan ke layar utama.
    }
  });
}

/**
 * Penilai bawaan: aman bila tidak ada barang di keranjang dan tidak ada
 * jendela yang sedang terbuka.
 *
 * Sengaja memeriksa DOM, bukan state modul, supaya berkas ini tetap bisa
 * dipakai halaman mana pun tanpa ikut menyeret lapisan state aplikasi.
 *
 * @returns {boolean}
 */
export function amanUntukMuatUlang() {
  const adaIsiKeranjang = document.querySelector("#cartItems .cart-item, #isiKeranjang .cart-item");
  const adaJendelaTerbuka = document.querySelector(".modal:not(.hidden), .layar-pembeli:not(.hidden)");
  return !adaIsiKeranjang && !adaJendelaTerbuka;
}
