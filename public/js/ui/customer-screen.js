/**
 * Layar pembeli — tampilan penuh yang diputar menghadap orang di seberang meja.
 *
 * Kenapa layar terpisah, bukan sekadar memperbesar modal kasir: yang membaca
 * layar ini bukan kasir. Ia berdiri, memegang ponsel, dan hanya perlu tahu
 * tiga hal — berapa yang harus dibayar, ke mana memindai, dan apakah sudah
 * masuk. Semua kendali kasir disingkirkan supaya tidak ada yang tertekan
 * tidak sengaja oleh pembeli.
 */
import { $, showToast } from "./shell.js";
import { money, escapeHtml, labelMetode } from "../format.js";
import { get } from "../state.js";
import { cartTotals } from "./cart.js";

/** Dipanggil saat kasir menekan "Pembayaran diterima". */
let onDiterima = null;

/**
 * @param {() => void} handler dijalankan ketika kasir menyatakan lunas
 */
export function setOnPembayaranDiterima(handler) {
  onDiterima = handler;
}

/**
 * Menampilkan layar pembeli.
 *
 * @param {object} info
 * @param {string|null} info.qrImage gambar QR, null bila mode tanpa QR
 * @param {string} info.orderId nomor acuan pembayaran
 * @param {string} info.keterangan pesan jujur soal mode pembayaran
 * @param {boolean} info.terverifikasi apakah status bisa dipastikan otomatis
 */
export function bukaLayarPembeli({ qrImage, orderId, keterangan, terverifikasi }) {
  const total = cartTotals().total;
  const namaToko = $("storeName")?.value?.trim() || "KasirOne Store";

  if ($("lpNamaToko")) $("lpNamaToko").textContent = namaToko;
  if ($("lpNominal")) $("lpNominal").textContent = money(total);
  if ($("lpNomor")) $("lpNomor").textContent = orderId ?? "—";

  const qr = $("lpQr");
  if (qr) {
    qr.innerHTML = qrImage
      ? `<img src="${escapeHtml(qrImage)}" alt="Kode QR pembayaran">`
      : `<div class="kosong">Tidak ada kode QR pada mode ini.<br>${escapeHtml(keterangan ?? "")}</div>`;
  }

  // Rincian belanja, diringkas agar tetap terbaca dari jarak setengah meter.
  const rincian = $("lpRincian");
  if (rincian) {
    const cart = get("cart");
    const jumlah = cart.reduce((s, i) => s + i.qty, 0);
    const baris = cart.slice(0, 4).map((i) => `
      <div class="lp-baris"><span>${escapeHtml(i.name)} &times;${i.qty}</span><strong>${money(i.hargaJual * i.qty)}</strong></div>`).join("");
    const sisa = cart.length > 4
      ? `<div class="lp-baris"><span>dan ${cart.length - 4} barang lain</span><strong></strong></div>`
      : "";

    rincian.innerHTML = `
      ${baris}${sisa}
      <div class="lp-baris"><span>Jumlah barang</span><strong>${jumlah}</strong></div>
      <div class="lp-baris"><span>Metode</span><strong>${escapeHtml(labelMetode(get("paymentMethod")))}</strong></div>`;
  }

  perbaruiStatus(terverifikasi ? "menunggu" : "manual", keterangan);

  // Tombol konfirmasi hanya boleh aktif bila kasir yang memutuskan (mode
  // manual). Pada mode gateway, tombolnya dibuka otomatis saat status lunas.
  const tombol = $("lpSelesai");
  if (tombol) tombol.disabled = Boolean(terverifikasi);

  $("layarPembeli")?.classList.remove("hidden");
}

/**
 * Memperbarui baris status di layar pembeli.
 * @param {"menunggu"|"lunas"|"gagal"|"manual"} keadaan
 * @param {string} [catatan]
 */
export function perbaruiStatus(keadaan, catatan = "") {
  const el = $("lpStatus");
  if (!el) return;

  el.className = "lp-status";
  if (keadaan === "lunas") {
    el.classList.add("lunas");
    el.textContent = "Pembayaran diterima. Terima kasih.";
    const tombol = $("lpSelesai");
    if (tombol) tombol.disabled = false;
  } else if (keadaan === "gagal") {
    el.classList.add("gagal");
    el.textContent = "Pembayaran gagal atau kedaluwarsa.";
  } else if (keadaan === "manual") {
    el.textContent = catatan || "Tunjukkan bukti transfer ke kasir.";
  } else {
    el.innerHTML = '<span class="spinner"></span> Menunggu pembayaran…';
  }
}

/** Menutup layar pembeli. */
export function tutupLayarPembeli() {
  $("layarPembeli")?.classList.add("hidden");
}

/** Memasang tombol-tombol layar pembeli. */
export function bindLayarPembeli() {
  $("tutupLayarPembeli")?.addEventListener("click", tutupLayarPembeli);

  $("lpSelesai")?.addEventListener("click", () => {
    tutupLayarPembeli();
    if (onDiterima) onDiterima();
    else showToast("Lanjutkan konfirmasi di layar kasir.", "info");
  });

  // Escape menutup layar, sama seperti modal lain.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") tutupLayarPembeli();
  });
}
