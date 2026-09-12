/**
 * Halaman Riwayat Transaksi (M7), lengkap dengan filter tanggal.
 * Menjawab kebutuhan "history barang yang sudah discan/terjual".
 */
import { $, showApiError } from "./shell.js";
import { money, angka, escapeHtml, tanggal, labelMetode } from "../format.js";
import { getApi } from "../api/index.js";
import { tampilkanStruk } from "./checkout.js";
import { set, get } from "../state.js";

/** Mengubah input <input type="date"> menjadi rentang ISO satu hari penuh. */
function rentangDari(fromValue, toValue) {
  if (!fromValue || !toValue) return {};
  const from = new Date(`${fromValue}T00:00:00`);
  const to = new Date(`${toValue}T23:59:59.999`);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Memuat & menggambar tabel riwayat sesuai filter aktif. */
export async function refreshTransactions() {
  const body = $("transactionTable");
  if (!body) return;

  try {
    const filter = { limit: 200, ...rentangDari($("trxFrom")?.value, $("trxTo")?.value) };
    const list = await getApi().listTransactions(filter);
    set("transactions", list);

    body.innerHTML = list.length
      ? list.map((t) => `
        <tr>
          <td><strong>${escapeHtml(t.receiptNumber ?? t.id)}</strong></td>
          <td>${escapeHtml(tanggal(t.createdAt))}</td>
          <td>${escapeHtml(t.cashierName ?? "-")}</td>
          <td>${escapeHtml(labelMetode(t.paymentMethod))}</td>
          <td>${angka(t.itemCount ?? 0)}</td>
          <td>${money(t.total)}</td>
          <td><button class="text-btn" data-struk="${escapeHtml(t.id)}">Lihat struk</button></td>
        </tr>`).join("")
      : `<tr><td colspan="7">Tidak ada transaksi pada rentang ini.</td></tr>`;

    body.querySelectorAll("[data-struk]").forEach((btn) => {
      btn.onclick = () => {
        const trx = get("transactions").find((t) => t.id === btn.dataset.struk);
        if (trx) tampilkanStruk(trx);
      };
    });

    renderTimeline(list);
  } catch (error) {
    showApiError(error);
  }
}

/** Jam-menit saja; tanggalnya sudah jelas dari filter di atas. */
function jam(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Riwayat sebagai garis waktu untuk layar sempit.
 *
 * Tabel tujuh kolom tidak terbaca di ponsel, sedangkan struk punya urutan
 * waktu yang jelas — jadi bentuk paling jujur untuk layar kecil adalah
 * garis waktu, dengan warna titik mengikuti metode pembayarannya.
 *
 * @param {Array<object>} list
 */
function renderTimeline(list) {
  const container = $("trxTimeline");
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="empty-cart">Tidak ada transaksi pada rentang ini.</div>`;
    return;
  }

  container.innerHTML = list.slice(0, 50).map((t, i) => {
    const metode = t.paymentMethod || "cash";
    return `
      <div class="tl-item" style="animation-delay:${Math.min(i, 10) * 0.04}s">
        <span class="tl-dot tl-${escapeHtml(metode)}"></span>
        <div class="ticket" data-struk-card="${escapeHtml(t.id)}">
          <div class="ticket-top">
            <div>
              <strong>${escapeHtml(t.receiptNumber ?? t.id)}</strong>
              <span>${escapeHtml(jam(t.createdAt))} · ${escapeHtml(t.cashierName ?? "-")} · ${angka(t.itemCount ?? 0)} item</span>
            </div>
            <span class="badge badge-${escapeHtml(metode)}">${escapeHtml(labelMetode(metode))}</span>
          </div>
          <div class="ticket-foot">
            <span>Ketuk untuk lihat struk</span>
            <strong>${money(t.total)}</strong>
          </div>
        </div>
      </div>`;
  }).join("");

  container.querySelectorAll("[data-struk-card]").forEach((card) => {
    card.onclick = () => {
      const trx = get("transactions").find((t) => t.id === card.dataset.strukCard);
      if (trx) tampilkanStruk(trx);
    };
  });
}

/** Memasang tombol filter tanggal. */
export function bindTransactionFilters() {
  $("trxFilterBtn")?.addEventListener("click", refreshTransactions);
  $("trxResetBtn")?.addEventListener("click", () => {
    if ($("trxFrom")) $("trxFrom").value = "";
    if ($("trxTo")) $("trxTo").value = "";
    refreshTransactions();
  });
}
