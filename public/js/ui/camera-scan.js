/**
 * Pemindaian barcode lewat kamera.
 *
 * Memakai BarcodeDetector bawaan peramban, bukan pustaka dari CDN. Alasannya
 * praktis: aplikasi kasir harus tetap bisa dibuka saat internet toko mati,
 * dan menambah berkas yang diunduh dari server orang lain membuat halaman
 * gagal dimuat persis pada saat paling genting.
 *
 * Tidak semua peramban punya API ini. Yang tidak punya tetap bisa memakai
 * scanner USB dan ketik manual, jadi tombol kamera disembunyikan saja
 * alih-alih memunculkan tombol yang menolak saat ditekan.
 */

/** @returns {boolean} apakah peramban ini bisa memindai lewat kamera */
export function kameraDidukung() {
  return typeof window.BarcodeDetector === "function"
    && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Format barcode yang lazim dipakai barang ritel Indonesia. */
const FORMAT = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

let stream = null;
let berhenti = false;

/**
 * Menyalakan kamera dan memindai sampai satu kode terbaca.
 *
 * @param {HTMLVideoElement} video elemen tempat gambar kamera ditampilkan
 * @param {(kode:string) => void} onKode dipanggil sekali saat kode terbaca
 * @returns {Promise<void>}
 * @throws {Error} bila izin kamera ditolak atau tidak ada kamera
 */
export async function mulaiPindai(video, onKode) {
  if (!kameraDidukung()) throw new Error("Peramban ini belum mendukung pindai kamera.");

  berhenti = false;
  const detector = new window.BarcodeDetector({ formats: FORMAT });

  try {
    // facingMode "environment" meminta kamera belakang. Di ponsel, kamera
    // depan hampir tidak berguna untuk memindai barang di meja.
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false
    });
  } catch (error) {
    // Pesan bawaan peramban terlalu teknis untuk kasir.
    throw new Error(
      error?.name === "NotAllowedError"
        ? "Izin kamera ditolak. Aktifkan lewat pengaturan peramban."
        : "Kamera tidak bisa dibuka. Gunakan scanner USB atau ketik manual."
    );
  }

  video.srcObject = stream;
  video.setAttribute("playsinline", "");   // iOS menolak memutar tanpa ini
  await video.play();

  /** Memeriksa satu bingkai lalu menjadwalkan bingkai berikutnya. */
  async function periksa() {
    if (berhenti) return;
    try {
      const hasil = await detector.detect(video);
      if (hasil.length > 0 && hasil[0].rawValue) {
        const kode = hasil[0].rawValue.trim();
        hentikanPindai();
        onKode(kode);
        return;
      }
    } catch {
      // Satu bingkai gagal dibaca bukan masalah; bingkai berikutnya dicoba.
    }
    // requestAnimationFrame mengikuti laju layar dan berhenti sendiri ketika
    // tab disembunyikan, jadi kamera tidak memeras baterai di latar belakang.
    requestAnimationFrame(periksa);
  }

  requestAnimationFrame(periksa);
}

/** Mematikan kamera. Wajib dipanggil, jika tidak lampu kamera tetap menyala. */
export function hentikanPindai() {
  berhenti = true;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}
