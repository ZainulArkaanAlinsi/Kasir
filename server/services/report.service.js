/**
 * Layanan laporan.
 *
 * Semua agregasi dihitung di server, bukan di browser. Alasannya bukan cuma
 * performa: kalau dashboard dan halaman Laporan sama-sama menghitung ulang
 * sendiri-sendiri, angkanya cepat atau lambat akan berbeda — persis masalah
 * "Single Source of Truth" yang jadi catatan di blueprint §6.
 */
import { getDb } from "./firebase.js";
import { lineProfit } from "../../public/js/shared/money.js";

/** Nama hari untuk grafik mingguan. Indeks mengikuti Date#getDay(). */
const NAMA_HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/**
 * Menghitung rentang tanggal preset.
 * @param {"today"|"week"|"month"} period
 * @param {Date} [now]
 * @returns {{from:Date, to:Date}}
 */
export function resolvePeriod(period, now = new Date()) {
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);

  // Periode yang tidak dikenal sengaja diperlakukan sebagai "week", sama
  // seperti default di rute dan di mode demo. Tanpa penyeragaman ini, input
  // tak terduga menghasilkan rentang berbeda antara server dan demo.
  const mundur = period === "today" ? 0 : period === "month" ? 29 : 6;
  from.setDate(from.getDate() - mundur);
  return { from, to };
}

/**
 * Menghitung selisih relatif antara dua angka.
 *
 * Kasus nol ditangani eksplisit karena pembagian dengan nol menghasilkan
 * Infinity, dan "naik tak terhingga persen" tidak berarti apa pun bagi
 * pemilik toko. Bila periode sebelumnya nol, kita hanya menyatakan ada
 * kenaikan tanpa persentase.
 *
 * @param {number} sekarang
 * @param {number} sebelumnya
 * @returns {{persen:number|null, arah:"naik"|"turun"|"tetap"}}
 */
export function bandingkan(sekarang, sebelumnya) {
  const a = Number(sekarang) || 0;
  const b = Number(sebelumnya) || 0;

  if (a === b) return { persen: 0, arah: "tetap" };
  if (b === 0) return { persen: null, arah: "naik" };

  const persen = Math.round(((a - b) / Math.abs(b)) * 100);
  return { persen, arah: persen >= 0 ? "naik" : "turun" };
}

/**
 * Rentang periode tepat SEBELUM rentang yang diberikan, dengan panjang sama.
 * Dipakai agar "naik 12%" punya arti: dibandingkan tujuh hari sebelumnya,
 * bukan angka karangan.
 *
 * @param {{from:Date, to:Date}} range
 * @returns {{from:Date, to:Date}}
 */
function periodeSebelumnya(range) {
  const durasi = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - durasi - 1),
    to: new Date(range.from.getTime() - 1)
  };
}

/**
 * Angka ringkas satu periode. Sengaja hanya menjumlah, tanpa agregasi produk,
 * karena dipakai sebagai pembanding, bukan untuk ditampilkan utuh.
 *
 * @param {{from:Date, to:Date}} range
 * @returns {Promise<{pemasukan:number, pengeluaran:number, labaKotor:number, jumlahTransaksi:number, totalItemTerjual:number}>}
 */
async function ringkasPeriode(range) {
  const db = getDb();
  const [trxSnap, expSnap] = await Promise.all([
    db.collection("transactions")
      .where("createdAt", ">=", range.from).where("createdAt", "<=", range.to).get(),
    db.collection("expenses")
      .where("createdAt", ">=", range.from).where("createdAt", "<=", range.to).get()
  ]);

  let pemasukan = 0;
  let labaKotor = 0;
  let totalItemTerjual = 0;

  for (const doc of trxSnap.docs) {
    const trx = doc.data();
    pemasukan += Number(trx.total) || 0;
    for (const line of trx.lines ?? []) {
      totalItemTerjual += Number(line.qty) || 0;
      labaKotor += lineProfit(line);
    }
  }

  return {
    pemasukan,
    pengeluaran: expSnap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0),
    labaKotor,
    jumlahTransaksi: trxSnap.size,
    totalItemTerjual
  };
}

/**
 * Laporan lengkap satu periode: pemasukan, pengeluaran, laba, produk terlaris.
 *
 * @param {{from:Date, to:Date}} range
 * @returns {Promise<{
 *   range:{from:string,to:string},
 *   pemasukan:number, pengeluaran:number, labaKotor:number, labaBersih:number,
 *   jumlahTransaksi:number, rataRataTransaksi:number, totalItemTerjual:number,
 *   perMetodeBayar:Record<string,{jumlah:number,total:number}>,
 *   produkTerjual:Array<{productId:string,name:string,qty:number,omzet:number,laba:number}>,
 *   grafikHarian:Array<{label:string,tanggal:string,total:number}>
 * }>}
 */
export async function buildReport(range) {
  const db = getDb();

  const [trxSnap, expSnap] = await Promise.all([
    db.collection("transactions")
      .where("createdAt", ">=", range.from).where("createdAt", "<=", range.to)
      .orderBy("createdAt", "asc").get(),
    db.collection("expenses")
      .where("createdAt", ">=", range.from).where("createdAt", "<=", range.to)
      .get()
  ]);

  let pemasukan = 0;
  let labaKotor = 0;
  let totalItemTerjual = 0;
  const perMetodeBayar = {};
  const perProduk = new Map();
  const perHari = new Map();

  for (const doc of trxSnap.docs) {
    const trx = doc.data();
    const total = Number(trx.total) || 0;
    pemasukan += total;

    const metode = trx.paymentMethod || "lainnya";
    perMetodeBayar[metode] ??= { jumlah: 0, total: 0 };
    perMetodeBayar[metode].jumlah += 1;
    perMetodeBayar[metode].total += total;

    const tanggal = trx.createdAt?.toDate?.() ?? new Date();
    const kunci = tanggal.toISOString().slice(0, 10);
    perHari.set(kunci, (perHari.get(kunci) || 0) + total);

    for (const line of trx.lines ?? []) {
      const qty = Number(line.qty) || 0;
      const omzet = (Number(line.hargaJual) || 0) * qty;
      const laba = lineProfit(line);

      totalItemTerjual += qty;
      labaKotor += laba;

      const agg = perProduk.get(line.productId) ?? { productId: line.productId, name: line.name, qty: 0, omzet: 0, laba: 0 };
      agg.qty += qty;
      agg.omzet += omzet;
      agg.laba += laba;
      perProduk.set(line.productId, agg);
    }
  }

  const pengeluaran = expSnap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0);

  // Pengeluaran dikelompokkan per hari juga, supaya grafik bisa menyandingkan
  // uang masuk dan uang keluar pada kolom yang sama. Tanpa ini pemilik toko
  // hanya melihat omzet naik, tanpa tahu berapa yang habis untuk restock.
  const perHariKeluar = new Map();
  for (const doc of expSnap.docs) {
    const biaya = doc.data();
    const tanggalBiaya = biaya.createdAt?.toDate?.() ?? new Date();
    const kunci = tanggalBiaya.toISOString().slice(0, 10);
    perHariKeluar.set(kunci, (perHariKeluar.get(kunci) || 0) + (Number(biaya.amount) || 0));
  }

  // Grafik harian dari transaksi ASLI (menggantikan array hardcode
  // [38,55,46,78,62,91,70] yang dulu ada di renderDashboard).
  const grafikHarian = [];
  for (let d = new Date(range.from); d <= range.to; d.setDate(d.getDate() + 1)) {
    const kunci = d.toISOString().slice(0, 10);
    grafikHarian.push({
      label: NAMA_HARI[d.getDay()],
      tanggal: kunci,
      total: perHari.get(kunci) || 0,
      keluar: perHariKeluar.get(kunci) || 0
    });
  }

  const jumlahTransaksi = trxSnap.size;

  // Pembanding terhadap periode sebelumnya yang panjangnya sama.
  const lalu = await ringkasPeriode(periodeSebelumnya(range));
  const perbandingan = {
    pemasukan: bandingkan(pemasukan, lalu.pemasukan),
    pengeluaran: bandingkan(pengeluaran, lalu.pengeluaran),
    labaKotor: bandingkan(labaKotor, lalu.labaKotor),
    jumlahTransaksi: bandingkan(jumlahTransaksi, lalu.jumlahTransaksi),
    totalItemTerjual: bandingkan(totalItemTerjual, lalu.totalItemTerjual)
  };

  return {
    perbandingan,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    pemasukan,
    pengeluaran,
    labaKotor,
    // Laba bersih memperhitungkan biaya restock & operasional pada periode ini.
    labaBersih: labaKotor - pengeluaran,
    jumlahTransaksi,
    rataRataTransaksi: jumlahTransaksi ? Math.round(pemasukan / jumlahTransaksi) : 0,
    totalItemTerjual,
    perMetodeBayar,
    produkTerjual: [...perProduk.values()].sort((a, b) => b.qty - a.qty),
    grafikHarian: grafikHarian.slice(-31)
  };
}
