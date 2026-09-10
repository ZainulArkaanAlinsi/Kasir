/**
 * Halaman Pengaturan.
 *
 * Tugas terpentingnya bukan mengubah setelan, melainkan MENYATAKAN keadaan
 * sistem apa adanya — terutama status pembayaran. Kasir berhak tahu apakah
 * QRIS yang ia tunjukkan benar-benar menagih uang atau tidak.
 */
import { $ } from "./shell.js";
import { get } from "../state.js";
import { getApi } from "../api/index.js";

const KUNCI_NAMA_TOKO = "kasirone_nama_toko";

/** Warna badge untuk tiap mode pembayaran. */
const GAYA_MODE = {
  gateway: { teks: "Terverifikasi", warna: "var(--ok)", latar: "var(--ok-soft)", garis: "rgba(47,224,164,.25)" },
  statis: { teks: "Manual", warna: "var(--warn)", latar: "var(--warn-soft)", garis: "rgba(255,178,36,.25)" },
  demo: { teks: "Demo", warna: "var(--muted)", latar: "var(--glass-2)", garis: "var(--edge)" },
  nonaktif: { teks: "Nonaktif", warna: "var(--danger)", latar: "var(--danger-soft)", garis: "rgba(255,77,94,.25)" }
};

/** Memuat status pembayaran dan menampilkannya di halaman Pengaturan. */
export async function refreshSettings() {
  const badge = $("qrisStatusBadge");
  const catatan = $("qrisStatusNote");

  // Label mode aktif (demo vs terhubung server).
  const mode = get("mode");
  const modeEl = $("settingMode");
  if (modeEl) modeEl.innerHTML = `<i></i> ${mode === "demo" ? "Demo" : "Terhubung server"}`;
  const modeLabel = $("modeLabel");
  if (modeLabel) modeLabel.textContent = mode === "demo" ? "Mode demo" : "Sistem online";

  if (!badge || !catatan) return;

  try {
    const status = await getApi().paymentStatus();
    const gaya = GAYA_MODE[status.mode] ?? GAYA_MODE.nonaktif;

    badge.textContent = status.lingkungan && status.lingkungan !== "-"
      ? `${gaya.teks} · ${status.lingkungan}`
      : gaya.teks;
    badge.style.color = gaya.warna;
    badge.style.background = gaya.latar;
    badge.style.borderColor = gaya.garis;
    catatan.textContent = status.keterangan;
  } catch {
    badge.textContent = "Tidak diketahui";
    catatan.textContent = "Status pembayaran gagal dimuat.";
  }
}

/** Menyimpan nama toko di perangkat ini agar struk memakainya. */
export function bindSettings() {
  const input = $("storeName");
  if (!input) return;

  try {
    const tersimpan = localStorage.getItem(KUNCI_NAMA_TOKO);
    if (tersimpan) input.value = tersimpan;
  } catch {
    // localStorage bisa diblokir; nama bawaan tetap dipakai.
  }

  input.addEventListener("change", () => {
    try {
      localStorage.setItem(KUNCI_NAMA_TOKO, input.value.trim() || "KasirOne Store");
    } catch {
      // Gagal menyimpan bukan alasan menghentikan kasir bekerja.
    }
  });
}
