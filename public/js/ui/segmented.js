/**
 * Pemilih periode berbentuk segmen (hari ini / mingguan / bulanan).
 *
 * Dropdown menyembunyikan pilihan sampai ditekan; padahal ketiga periode
 * ini yang paling sering dibolak-balik pemilik toko. Segmen membuat semua
 * pilihan terlihat sekaligus, dan penanda gelapnya bergeser mengikuti
 * pilihan sehingga perpindahan terasa disengaja, bukan berkedip.
 *
 * <select> aslinya tidak dibuang — hanya disembunyikan. Dashboard dan
 * laporan tetap membaca `.value` dari sana, jadi tidak ada dua sumber
 * kebenaran soal "periode mana yang sedang aktif".
 */
import { $ } from "./shell.js";

/**
 * Menghubungkan satu grup segmen ke <select> tersembunyi.
 *
 * @param {string} segId id elemen .seg
 * @param {string} selectId id <select> yang jadi sumber kebenaran
 */
export function bindSeg(segId, selectId) {
  const seg = $(segId);
  const select = $(selectId);
  if (!seg || !select) return;

  const tombol = [...seg.querySelectorAll("[data-period]")];
  const thumb = seg.querySelector(".seg-thumb");

  /** Menggeser penanda dan menandai tombol yang aktif. */
  function sorot(nilai) {
    const index = tombol.findIndex((b) => b.dataset.period === nilai);
    if (index < 0) return;
    tombol.forEach((b, i) => b.classList.toggle("active", i === index));
    if (thumb) thumb.style.transform = `translateX(${index * 100}%)`;
  }

  tombol.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (select.value === btn.dataset.period) return;
      select.value = btn.dataset.period;
      sorot(btn.dataset.period);
      // Memicu 'change' supaya pemuatan data tetap lewat satu jalur yang
      // sama dengan saat <select> dipakai langsung.
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  sorot(select.value);
}
