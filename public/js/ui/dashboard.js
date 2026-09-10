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

/** Nama periode untuk teks pembanding. */
const NAMA_PERIODE = { today: "kemarin", week: "7 hari sebelumnya", month: "30 hari sebelumnya" };

/**
 * Menggambar badge tren periode-ke-periode.
 *
 * Persentase hanya ditampilkan bila periode sebelumnya punya angka. Kalau
 * sebelumnya nol, "naik tak terhingga persen" tidak berarti apa pun — jadi
 * yang ditulis hanya "baru". Ini juga alasan badge lama yang berbunyi
 * "+12.5% dari kemarin" dihapus: angkanya dulu dikarang, tidak dihitung.
 *
 * @param {string} elementId
 * @param {{persen:number|null, arah:string}|undefined} tren
 * @param {string} periode
 * @param {boolean} [naikItuBaik] pengeluaran naik bukan kabar baik
 */
function renderTren(elementId, tren, periode, naikItuBaik = true) {
  const el = $(elementId);
  if (!el) return;

  const banding = NAMA_PERIODE[periode] ?? "periode sebelumnya";
  if (!tren) { el.textContent = `vs ${banding}`; return; }

  if (tren.persen === null) {
    el.innerHTML = `<span class="trend trend-up">baru</span> vs ${escapeHtml(banding)}`;
    return;
  }
  if (tren.arah === "tetap") {
    el.textContent = `Sama dengan ${banding}`;
    return;
  }

  const naik = tren.arah === "naik";
  const kelas = (naik === naikItuBaik) ? "trend-up" : "trend-down";
  const panah = naik ? "↑" : "↓";
  el.innerHTML = `<span class="trend ${kelas}">${panah} ${Math.abs(tren.persen)}%</span> vs ${escapeHtml(banding)}`;
}

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

    const p = report.perbandingan ?? {};
    renderTren("trendSales", p.pemasukan, periode);
    renderTren("trendTransactions", p.jumlahTransaksi, periode);
    renderTren("trendItems", p.totalItemTerjual, periode);
    renderTren("trendProfit", p.labaKotor, periode);

    renderChart(report.grafikHarian);
    renderRingkasanGrafik(report.grafikHarian);
    renderStokMenipis(produk);
    await renderAktivitasTerbaru();
  } catch (error) {
    showApiError(error);
  }
}

/**
 * Menulis rata-rata harian di bawah judul grafik, supaya batang punya
 * titik acuan. Tanpa ini, tinggi batang hanya relatif satu sama lain dan
 * tidak memberi tahu apa pun soal besarannya.
 *
 * @param {Array<{total:number}>} data
 */
function renderRingkasanGrafik(data) {
  const el = $("chartSummary");
  if (!el) return;

  const hariAktif = (data ?? []).filter((d) => d.total > 0);
  if (hariAktif.length === 0) {
    el.textContent = "Nilai transaksi per hari";
    return;
  }

  const rata = Math.round(hariAktif.reduce((s, d) => s + d.total, 0) / hariAktif.length);
  const tertinggi = Math.max(...hariAktif.map((d) => d.total));
  el.textContent = `Rata-rata ${money(rata)}/hari · tertinggi ${money(tertinggi)}`;
}

/**
 * Daftar produk yang perlu direstock, diurutkan dari yang paling mendesak.
 * Ini menjawab kebutuhan "kalau menipis kelihatan" tanpa harus membuka
 * halaman Produk dan memindai satu per satu.
 *
 * @param {Array<object>} produk
 */
function renderStokMenipis(produk) {
  const container = $("lowStockList");
  if (!container) return;

  const menipis = produk
    .filter(isLowStock)
    .sort((a, b) => (Number(a.stok) || 0) - (Number(b.stok) || 0))
    .slice(0, 6);

  if (menipis.length === 0) {
    container.innerHTML = `<p class="muted" style="padding:10px 8px">Semua stok aman.</p>`;
    return;
  }

  container.innerHTML = menipis.map((p) => {
    const stok = Number(p.stok) || 0;
    const kelas = stok <= 0 ? "out-badge" : "low-badge";
    const label = stok <= 0 ? "Habis" : `Sisa ${angka(stok)}`;
    return `
      <div class="activity">
        <div>
          <strong>${escapeHtml(p.name)}</strong>
          <span>Ambang minimum ${angka(p.stokMinimum ?? 5)}</span>
        </div>
        <span class="badge ${kelas}">${label}</span>
      </div>`;
  }).join("");
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
