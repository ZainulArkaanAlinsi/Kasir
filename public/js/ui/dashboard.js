/**
 * Dashboard.
 *
 * Seluruh angka berasal dari endpoint laporan yang dihitung server, bukan
 * dihitung ulang di sini. Grafik mingguan kini memakai transaksi ASLI —
 * menggantikan array statis [38,55,46,78,62,91,70] yang dulu dipajang
 * seolah-olah data penjualan sungguhan.
 */
import { get, set } from "../state.js";
import { $, showApiError } from "./shell.js";
import { money, angka, escapeHtml, tanggal, tanggalPendek } from "../format.js";
import { isLowStock } from "../shared/product.js";
import { getApi } from "../api/index.js";

/** Tinggi batang grafik dalam persen, relatif terhadap hari terlaris. */
function tinggiBatang(nilai, maksimum) {
  if (maksimum <= 0) return 2;
  return Math.max(2, Math.round((nilai / maksimum) * 100));
}

/**
 * Menggambar grafik penjualan harian.
 * @param {Array<{label:string, tanggal:string, total:number}>} data
 */
function renderChart(data) {
  const container = $("barChart");
  if (!container) return;

  if (!data?.length) {
    container.innerHTML = `<p class="muted">Belum ada transaksi pada periode ini.</p>`;
    return;
  }

  const maksimum = Math.max(...data.map((d) => d.total));
  container.innerHTML = data.map((d) => `
    <div class="bar" style="height:${tinggiBatang(d.total, maksimum)}%"
         title="${escapeHtml(tanggalPendek(d.tanggal))}: ${money(d.total)}">
      <span>${escapeHtml(d.label)}</span>
    </div>`).join("");
}

/** Memuat & menggambar seluruh dashboard. */
export async function refreshDashboard() {
  try {
    const periode = $("chartPeriod")?.value || "week";
    const report = await getApi().getReport({ period: periode });
    set("report", report);

    const produk = get("products");
    const stokMenipis = produk.filter(isLowStock).length;

    if ($("statSales")) $("statSales").textContent = money(report.pemasukan);
    if ($("statTransactions")) $("statTransactions").textContent = angka(report.jumlahTransaksi);
    if ($("statItems")) $("statItems").textContent = angka(report.totalItemTerjual);
    if ($("statLowStock")) $("statLowStock").textContent = angka(stokMenipis);
    if ($("statProfit")) $("statProfit").textContent = money(report.labaKotor);

    renderChart(report.grafikHarian);
    await renderAktivitasTerbaru();
  } catch (error) {
    showApiError(error);
  }
}

/** Daftar transaksi terbaru di panel kanan dashboard. */
async function renderAktivitasTerbaru() {
  const container = $("recentTransactions");
  if (!container) return;

  const list = await getApi().listTransactions({ limit: 6 });
  set("transactions", list);

  container.innerHTML = list.length
    ? list.map((t) => `
      <div class="activity">
        <div>
          <strong>${escapeHtml(t.receiptNumber ?? t.id)}</strong>
          <span>${escapeHtml(tanggal(t.createdAt))}</span>
        </div>
        <b>${money(t.total)}</b>
      </div>`).join("")
    : `<p class="muted">Belum ada transaksi.</p>`;
}
