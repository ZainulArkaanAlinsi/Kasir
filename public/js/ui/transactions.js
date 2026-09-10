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
  } catch (error) {
    showApiError(error);
  }
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
