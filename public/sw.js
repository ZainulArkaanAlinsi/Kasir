/**
 * Service worker KasirOne.
 *
 * Dua tugasnya:
 *
 *  1. Membuat aplikasi bisa dipasang ke layar utama ponsel dan tetap terbuka
 *     saat sinyal hilang — hal biasa di toko yang wifinya putus-putus.
 *  2. Memperbarui dirinya sendiri. Kasir tidak boleh dituntut menekan tombol
 *     "perbarui"; versi yang dipakai harus selalu yang terbaru tanpa ia
 *     memikirkannya.
 *
 * Strateginya JARINGAN DULU, bukan cache dulu. Untuk aplikasi kasir,
 * menyajikan berkas lama demi kecepatan adalah pertukaran yang salah: harga
 * dan stok basi merugikan uang sungguhan. Cache hanya dipakai sebagai jaring
 * pengaman ketika jaringan benar-benar tidak bisa dihubungi.
 *
 * Permintaan ke /api/ TIDAK PERNAH disimpan. Di sanalah stok dan harga
 * berada, dan jawaban basi atas pertanyaan "masih ada berapa?" jauh lebih
 * berbahaya daripada pesan galat yang jujur.
 */

/* Dinaikkan setiap rilis. Perubahannya membuat peramban mengunduh ulang
   service worker ini, yang lalu membuang cache versi sebelumnya. */
const VERSI = "kasirone-v1";

/** Kerangka aplikasi: cukup untuk membuka layar pertama tanpa jaringan. */
const KERANGKA = [
  "/",
  "/index.html",
  "/toko.html",
  "/style.css",
  "/toko.css",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/js/main.js",
  "/js/toko.js"
];

self.addEventListener("install", (event) => {
  // Langsung menggantikan versi lama alih-alih menunggu semua tab ditutup.
  // Tanpa ini, ponsel yang tidak pernah menutup aplikasinya bisa memakai
  // versi lama berhari-hari.
  self.skipWaiting();

  event.waitUntil((async () => {
    const cache = await caches.open(VERSI);
    // cache:"reload" memaksa ambil dari jaringan, melewati cache HTTP —
    // kalau tidak, pemasangan versi baru justru bisa menyimpan berkas lama.
    await Promise.allSettled(
      KERANGKA.map((url) => cache.add(new Request(url, { cache: "reload" })))
    );
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const kunci = await caches.keys();
    await Promise.all(kunci.filter((k) => k !== VERSI).map((k) => caches.delete(k)));
    // Mengambil alih halaman yang sudah terbuka pada detik ini juga.
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // font CDN dll: biarkan apa adanya
  if (url.pathname.startsWith("/api/")) return;      // data selalu langsung dari server

  event.respondWith((async () => {
    try {
      const jawaban = await fetch(req);
      if (jawaban.ok) {
        const cache = await caches.open(VERSI);
        cache.put(req, jawaban.clone());
      }
      return jawaban;
    } catch {
      // Jaringan mati: pakai salinan terakhir yang kita punya.
      const tersimpan = await caches.match(req);
      if (tersimpan) return tersimpan;

      // Untuk perpindahan halaman, kembalikan kerangka aplikasi supaya
      // layarnya tetap terbuka alih-alih menampilkan halaman galat peramban.
      if (req.mode === "navigate") {
        const kerangka = await caches.match("/index.html");
        if (kerangka) return kerangka;
      }
      throw new Error("Tidak ada jaringan dan tidak ada salinan tersimpan.");
    }
  })());
});

/** Memungkinkan halaman meminta pembaruan segera diterapkan. */
self.addEventListener("message", (event) => {
  if (event.data === "terapkan-pembaruan") self.skipWaiting();
});
