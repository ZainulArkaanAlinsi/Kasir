/**
 * Ekspor CSV.
 *
 * Dipisah dari modul tampilan karena pemilik toko biasanya ingin membuka
 * data ini di Excel untuk laporan pajak atau rekap bulanan, dan kebutuhan
 * itu tidak ada hubungannya dengan cara tabel digambar di layar.
 */
import { showToast } from "./shell.js";

/**
 * Mengubah satu nilai menjadi sel CSV yang aman.
 *
 * Dua hal ditangani di sini:
 * - Tanda kutip, koma, dan baris baru dibungkus supaya kolom tidak bergeser.
 * - Nilai yang diawali =, +, -, atau @ diberi kutip tunggal di depan. Tanpa
 *   itu, Excel memperlakukannya sebagai rumus — nama produk seperti
 *   "=Indomie" bisa berubah menjadi sesuatu yang dieksekusi saat dibuka.
 *
 * @param {unknown} nilai
 * @returns {string}
 */
function sel(nilai) {
  let teks = nilai === null || nilai === undefined ? "" : String(nilai);
  if (/^[=+\-@\t\r]/.test(teks)) teks = `'${teks}`;
  if (/[",\n\r;]/.test(teks)) teks = `"${teks.replaceAll('"', '""')}"`;
  return teks;
}

/**
 * Membuat isi berkas CSV.
 * @param {string[]} kepala
 * @param {Array<Array<unknown>>} baris
 * @returns {string}
 */
export function buatCsv(kepala, baris) {
  // Pemisah titik koma dipakai karena Excel berlokal Indonesia membaca koma
  // sebagai desimal, sehingga file berkoma akan menumpuk di satu kolom.
  const isi = [kepala, ...baris].map((r) => r.map(sel).join(";")).join("\r\n");
  return isi;
}

/**
 * Mengunduh teks sebagai berkas.
 * BOM UTF-8 disertakan supaya huruf beraksen dan simbol rupiah tidak rusak
 * saat berkas dibuka di Excel Windows.
 *
 * @param {string} namaBerkas
 * @param {string} isi
 */
export function unduh(namaBerkas, isi) {
  try {
    const blob = new Blob(["\uFEFF" + isi], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = namaBerkas;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`${namaBerkas} diunduh.`, "success");
  } catch {
    showToast("Peramban menolak mengunduh berkas.", "error");
  }
}

/** Stempel tanggal untuk nama berkas, mis. 2026-09-11. */
export const stempel = () => new Date().toISOString().slice(0, 10);

/**
 * Mengekspor daftar transaksi.
 * @param {Array<object>} transaksi
 */
export function eksporTransaksi(transaksi) {
  if (!transaksi?.length) {
    showToast("Tidak ada transaksi untuk diekspor.", "error");
    return;
  }

  const baris = transaksi.map((t) => [
    t.receiptNumber ?? t.id,
    t.createdAt ?? "",
    t.cashierName ?? "",
    t.paymentMethod ?? "",
    t.itemCount ?? 0,
    t.subtotal ?? 0,
    t.discount ?? 0,
    t.tax ?? 0,
    t.total ?? 0,
    (t.lines ?? []).map((l) => `${l.name} x${l.qty}`).join(" | ")
  ]);

  unduh(
    `transaksi-${stempel()}.csv`,
    buatCsv(
      ["No Struk", "Waktu", "Kasir", "Metode", "Jumlah Item", "Subtotal", "Diskon", "Pajak", "Total", "Rincian"],
      baris
    )
  );
}

/**
 * Mengekspor ringkasan laporan beserta rincian produk terjual.
 * @param {object} report hasil dari getReport()
 */
export function eksporLaporan(report) {
  if (!report) {
    showToast("Laporan belum dimuat.", "error");
    return;
  }

  const ringkas = [
    ["Pemasukan", report.pemasukan],
    ["Pengeluaran", report.pengeluaran],
    ["Laba kotor", report.labaKotor],
    ["Laba bersih", report.labaBersih],
    ["Jumlah transaksi", report.jumlahTransaksi],
    ["Rata-rata transaksi", report.rataRataTransaksi],
    ["Total item terjual", report.totalItemTerjual]
  ];

  const produk = (report.produkTerjual ?? []).map((p) => [p.name, p.qty, p.omzet, p.laba]);

  const isi = [
    buatCsv(["Ringkasan", "Nilai"], ringkas),
    "",
    buatCsv(["Produk", "Terjual", "Omzet", "Laba"], produk)
  ].join("\r\n");

  unduh(`laporan-${stempel()}.csv`, isi);
}
