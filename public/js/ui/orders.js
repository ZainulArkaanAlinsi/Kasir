/**
 * Panel pesanan untuk staf toko (M14).
 *
 * Tanpa halaman ini pesanan online masuk ke database tapi tidak ada yang tahu
 * harus mengerjakannya. Tugasnya sederhana tapi penting: menunjukkan apa yang
 * perlu dikerjakan sekarang, dan memindahkan pesanan ke tahap berikutnya.
 *
 * Tombol aksi dibangun dari tabel transisi, bukan ditulis satu per satu per
 * status. Dengan begitu aturan "boleh pindah ke mana" hanya hidup di satu
 * tempat, dan server tetap menjadi penentu akhirnya.
 */
import { $, $$, showToast, showApiError, withBusy, openModal } from "./shell.js";
import { money, angka, escapeHtml, tanggal, labelMetode } from "../format.js";
import { getApi } from "../api/index.js";
import { get, set } from "../state.js";

/** Label manusiawi untuk tiap status. */
const LABEL = {
  menunggu_bayar: "Menunggu bayar",
  dibayar: "Sudah dibayar",
  disiapkan: "Sedang disiapkan",
  siap_diambil: "Siap diambil",
  dikirim: "Dalam pengiriman",
  selesai: "Selesai",
  batal: "Dibatalkan",
  kedaluwarsa: "Kedaluwarsa"
};

/** Warna badge per status. */
const NADA = {
  menunggu_bayar: "low-badge",
  dibayar: "",
  disiapkan: "",
  siap_diambil: "",
  dikirim: "",
  selesai: "",
  batal: "out-badge",
  kedaluwarsa: "out-badge"
};

/** Aksi berikutnya yang masuk akal untuk tiap status. */
const AKSI = {
  menunggu_bayar: [{ ke: "dibayar", teks: "Tandai lunas" }, { ke: "batal", teks: "Batalkan", bahaya: true }],
  dibayar: [{ ke: "disiapkan", teks: "Mulai siapkan" }, { ke: "batal", teks: "Batalkan", bahaya: true }],
  disiapkan: [
    { ke: "siap_diambil", teks: "Siap diambil", hanya: "pickup" },
    { ke: "dikirim", teks: "Kirim", hanya: "delivery" },
    { ke: "batal", teks: "Batalkan", bahaya: true }
  ],
  siap_diambil: [{ ke: "selesai", teks: "Sudah diambil" }],
  dikirim: [{ ke: "selesai", teks: "Sudah sampai" }],
  selesai: [], batal: [], kedaluwarsa: []
};

/** Memuat daftar pesanan sesuai filter status yang dipilih. */
export async function refreshOrders() {
  const body = $("orderTable");
  if (!body) return;

  try {
    const status = $("orderStatusFilter")?.value || "";
    const list = await getApi().daftarPesanan({ status: status || undefined, limit: 100 });
    set("orders", list);

    const menunggu = list.filter((o) => ["menunggu_bayar", "dibayar", "disiapkan"].includes(o.status)).length;
    if ($("navOrderCount")) $("navOrderCount").textContent = String(menunggu);
    if ($("orderPendingCount")) $("orderPendingCount").textContent = angka(menunggu);

    if (list.length === 0) {
      body.innerHTML = `<tr><td colspan="7">Belum ada pesanan pada saringan ini.</td></tr>`;
      return;
    }

    body.innerHTML = list.map((o) => {
      const cara = o.pengiriman?.cara === "delivery" ? "Dikirim" : "Ambil di toko";
      const aksi = (AKSI[o.status] ?? [])
        .filter((a) => !a.hanya || a.hanya === o.pengiriman?.cara)
        .map((a) => `<button class="btn btn-sm ${a.bahaya ? "btn-danger" : "btn-secondary"}"
                       data-order="${escapeHtml(o.id)}" data-ke="${a.ke}">${a.teks}</button>`)
        .join(" ");

      return `
        <tr>
          <td><strong>${escapeHtml(o.orderNumber ?? o.id)}</strong><br><small>${escapeHtml(tanggal(o.createdAt))}</small></td>
          <td>${escapeHtml(o.customerName ?? "-")}<br><small>${escapeHtml(o.customerPhone ?? "")}</small></td>
          <td>${escapeHtml(cara)}${o.pengiriman?.alamat ? `<br><small>${escapeHtml(o.pengiriman.alamat.slice(0, 40))}…</small>` : ""}</td>
          <td>${angka((o.lines ?? []).reduce((s, l) => s + l.qty, 0))}</td>
          <td>${money(o.total)}</td>
          <td><span class="badge ${NADA[o.status] ?? ""}">${escapeHtml(LABEL[o.status] ?? o.status)}</span></td>
          <td>
            <button class="text-btn" data-detail="${escapeHtml(o.id)}">Detail</button>
            ${aksi}
          </td>
        </tr>`;
    }).join("");
  } catch (error) {
    showApiError(error);
  }
}

/** Menampilkan rincian satu pesanan. */
function tampilkanDetail(pesanan) {
  const el = $("orderDetail");
  if (!el) return;

  const item = (pesanan.lines ?? []).map((l) => `
    <div class="receipt-line">
      <span>${escapeHtml(l.name)} &times;${l.qty}</span>
      <span>${money(l.hargaJual * l.qty)}</span>
    </div>`).join("");

  const riwayat = (pesanan.riwayatStatus ?? []).map((r) => `
    <div class="receipt-line">
      <span>${escapeHtml(LABEL[r.status] ?? r.status)}</span>
      <span>${escapeHtml(tanggal(r.pada))}</span>
    </div>`).join("");

  const kirim = pesanan.pengiriman ?? {};
  el.innerHTML = `
    <strong>${escapeHtml(pesanan.orderNumber ?? pesanan.id)}</strong><br>
    ${escapeHtml(pesanan.customerName ?? "-")} ${pesanan.customerPhone ? `&middot; ${escapeHtml(pesanan.customerPhone)}` : ""}<br>
    ${escapeHtml(kirim.cara === "delivery" ? "Dikirim" : "Ambil di toko")}
    ${kirim.alamat ? `<br>${escapeHtml(kirim.alamat)}` : ""}
    ${kirim.catatan ? `<br>Catatan: ${escapeHtml(kirim.catatan)}` : ""}
    <hr>${item}<hr>
    <div class="receipt-line"><span>Subtotal</span><span>${money(pesanan.subtotal)}</span></div>
    <div class="receipt-line"><span>Pajak</span><span>${money(pesanan.tax)}</span></div>
    <div class="receipt-line"><span>Ongkir</span><span>${money(pesanan.ongkir)}</span></div>
    <div class="receipt-line"><strong>Total</strong><strong>${money(pesanan.total)}</strong></div>
    ${pesanan.paymentMethod ? `<div class="receipt-line"><span>Pembayaran</span><span>${escapeHtml(labelMetode(pesanan.paymentMethod))}</span></div>` : ""}
    <hr><strong>Riwayat</strong>${riwayat}`;

  openModal("orderModal");
}

/** Memasang saringan status dan tombol aksi pada tabel. */
export function bindOrders() {
  $("orderStatusFilter")?.addEventListener("change", refreshOrders);
  $("orderCleanupBtn")?.addEventListener("click", async (e) => {
    await withBusy(e.currentTarget, async () => {
      try {
        const hasil = await getApi().bersihkanKedaluwarsa();
        showToast(`${hasil.diproses} pesanan kedaluwarsa dibersihkan.`, "success");
        await refreshOrders();
        document.dispatchEvent(new CustomEvent("kasirone:stok-berubah"));
      } catch (error) {
        showApiError(error);
      }
    });
  });

  // Tombol dibuat ulang setiap render, jadi dipasang lewat delegasi.
  $("orderTable")?.addEventListener("click", async (event) => {
    const detail = event.target.closest("[data-detail]");
    if (detail) {
      const pesanan = get("orders")?.find((o) => o.id === detail.dataset.detail);
      if (pesanan) tampilkanDetail(pesanan);
      return;
    }

    const aksi = event.target.closest("[data-order]");
    if (!aksi) return;

    await withBusy(aksi, async () => {
      try {
        await getApi().ubahStatusPesanan(aksi.dataset.order, aksi.dataset.ke);
        showToast(`Pesanan diperbarui: ${LABEL[aksi.dataset.ke] ?? aksi.dataset.ke}.`, "success");
        await refreshOrders();
        // Status batal dan selesai mengubah stok, jadi halaman lain ikut disegarkan.
        document.dispatchEvent(new CustomEvent("kasirone:stok-berubah"));
      } catch (error) {
        showApiError(error);
      }
    });
  });
}
