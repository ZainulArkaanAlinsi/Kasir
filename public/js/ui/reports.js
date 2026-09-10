/**
 * Halaman Laporan (M6).
 *
 * Menjawab langsung permintaan pemilik toko: pemasukan vs pengeluaran per
 * periode, laba, dan jumlah barang terjual per produk — misalnya
 * "Indomie Goreng 23 pcs, Top Kopi Aren 40 pcs".
 */
import { $, showApiError } from "./shell.js";
import { money, angka, escapeHtml, labelMetode } from "../format.js";
import { getApi } from "../api/index.js";

/** Memuat laporan untuk periode yang dipilih dan menggambar seluruh panel. */
export async function refreshReport() {
  try {
    const period = $("reportPeriod")?.value || "week";
    const report = await getApi().getReport({ period });

    const isi = (id, nilai) => { if ($(id)) $(id).textContent = nilai; };

    isi("reportRevenue", money(report.pemasukan));
    isi("reportExpense", money(report.pengeluaran));
    isi("reportProfit", money(report.labaKotor));
    isi("reportNet", money(report.labaBersih));
    isi("reportCount", angka(report.jumlahTransaksi));
    isi("reportAverage", money(report.rataRataTransaksi));

    renderMetodeBayar(report.perMetodeBayar);
    renderProdukTerjual(report.produkTerjual);
  } catch (error) {
    showApiError(error);
  }
}

/** @param {Record<string,{jumlah:number,total:number}>} data */
function renderMetodeBayar(data) {
  const body = $("paymentBreakdown");
  if (!body) return;

  const entri = Object.entries(data ?? {});
  body.innerHTML = entri.length
    ? entri.map(([metode, v]) => `
      <tr>
        <td><strong>${escapeHtml(labelMetode(metode))}</strong></td>
        <td>${angka(v.jumlah)} transaksi</td>
        <td>${money(v.total)}</td>
      </tr>`).join("")
    : `<tr><td colspan="3">Belum ada transaksi pada periode ini.</td></tr>`;
}

/**
 * Tabel "berapa banyak tiap barang terjual".
 * @param {Array<{name:string, qty:number, omzet:number, laba:number}>} data
 */
function renderProdukTerjual(data) {
  const body = $("soldProducts");
  if (!body) return;

  body.innerHTML = data?.length
    ? data.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${angka(p.qty)} pcs</td>
        <td>${money(p.omzet)}</td>
        <td class="${p.laba >= 0 ? "positive" : "warning-text"}">${money(p.laba)}</td>
      </tr>`).join("")
    : `<tr><td colspan="5">Belum ada barang terjual pada periode ini.</td></tr>`;
}
