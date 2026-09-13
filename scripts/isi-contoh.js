#!/usr/bin/env node
/**
 * Mengisi toko dengan data contoh yang lengkap.
 *
 * Aplikasi yang kosong menyembunyikan kesalahannya sendiri: grafik kosong,
 * laporan nol, daftar kosong — semuanya terlihat "baik-baik saja" padahal
 * belum ada yang benar-benar dicoba. Skrip ini mengisi katalog (berikut foto
 * sungguhan dari DummyJSON), lalu membuat riwayat transaksi, pengeluaran,
 * dan pesanan yang tersebar sepanjang sebulan terakhir, sehingga tiap
 * halaman punya sesuatu untuk digambar dan kesalahannya bisa terlihat.
 *
 * Semua yang dibuat di sini ditandai `contoh: true`. Itu yang membuatnya
 * bisa dihapus bersih nanti tanpa ikut membawa data penjualan sungguhan:
 *
 *   node scripts/isi-contoh.js              # isi
 *   node scripts/isi-contoh.js --bersihkan  # hapus lagi
 *
 * Transaksi ditulis langsung ke Firestore, bukan lewat createTransaction(),
 * karena layanan itu selalu memberi cap waktu "sekarang" — sedangkan yang
 * dibutuhkan justru riwayat yang tersebar ke belakang supaya grafik harian
 * dan pembanding antarperiode ada isinya.
 */
import "dotenv/config";
import { initFirebase, getDb, admin } from "../server/services/firebase.js";
import { imporDariDummyJson } from "../server/services/import.service.js";
import { computeTotals } from "../public/js/shared/money.js";

const BERSIHKAN = process.argv.includes("--bersihkan");
const HARI_KE_BELAKANG = 30;
const KASIR = [
  { uid: "contoh-kasir-1", nama: "Nabila Pramesti" },
  { uid: "contoh-kasir-2", nama: "Rizky Ananda" }
];
const METODE = ["cash", "cash", "cash", "qris", "qris", "card"];   // tunai paling sering

const acak = (n) => Math.floor(Math.random() * n);
const pilih = (arr) => arr[acak(arr.length)];
const ekor = (id) => String(id).slice(0, 6).toUpperCase();
const capHari = (d) => d.toISOString().slice(0, 10).replaceAll("-", "");

/**
 * Menghapus seluruh dokumen bertanda contoh pada satu koleksi.
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} nama
 */
async function hapusContoh(db, nama) {
  let total = 0;
  for (;;) {
    const snap = await db.collection(nama).where("contoh", "==", true).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
  }
  console.log(`  ${nama.padEnd(14)} ${total} dokumen contoh dihapus`);
  return total;
}

/**
 * Waktu acak pada hari ke-N ke belakang, di dalam jam buka toko (08.00–21.00).
 * @param {number} hariLalu
 */
function waktuBelanja(hariLalu) {
  const d = new Date();
  d.setDate(d.getDate() - hariLalu);
  d.setHours(8 + acak(13), acak(60), acak(60), 0);
  return d;
}

async function main() {
  if (!initFirebase()) {
    console.error("Firebase Admin tidak siap. Periksa .env / serviceAccountKey.json.");
    process.exit(1);
  }
  const db = getDb();

  if (BERSIHKAN) {
    console.log("Menghapus data contoh…");
    for (const c of ["transactions", "expenses", "orders", "products"]) await hapusContoh(db, c);
    console.log("\nSelesai. Data sungguhan (yang tanpa tanda contoh) tidak disentuh.");
    return;
  }

  // ── 1. Katalog, lengkap dengan foto asli ────────────────────────────────
  console.log("Mengimpor katalog dari DummyJSON (berikut fotonya)…");
  const hasil = await imporDariDummyJson({ limit: 40, adminUid: "contoh-admin" });
  console.log(`  ${hasil.disimpan ?? hasil.jumlah ?? "?"} produk masuk katalog`);

  const snapProduk = await db.collection("products").get();
  const produk = snapProduk.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (produk.length === 0) throw new Error("Katalog masih kosong setelah impor.");

  // Tandai produk hasil impor supaya ikut terhapus saat --bersihkan.
  {
    const batch = db.batch();
    snapProduk.docs.forEach((d) => batch.update(d.ref, { contoh: true }));
    await batch.commit();
  }

  // ── 2. Riwayat transaksi sebulan terakhir ───────────────────────────────
  console.log("Membuat riwayat transaksi…");
  const terjual = new Map();          // productId -> qty, untuk menyesuaikan stok
  let batch = db.batch();
  let menunggu = 0;
  let jumlahTrx = 0;

  for (let hari = HARI_KE_BELAKANG; hari >= 0; hari--) {
    // Akhir pekan dibuat lebih ramai supaya grafik mingguan punya bentuk,
    // bukan garis datar yang tidak memberi tahu apa pun.
    const tanggal = waktuBelanja(hari);
    const akhirPekan = [0, 6].includes(tanggal.getDay());
    const banyak = (akhirPekan ? 6 : 3) + acak(4);

    for (let i = 0; i < banyak; i++) {
      const waktu = waktuBelanja(hari);
      const kasir = pilih(KASIR);
      const metode = pilih(METODE);

      const lines = [];
      for (let n = 0; n < 1 + acak(4); n++) {
        const p = pilih(produk);
        if (lines.some((l) => l.productId === p.id)) continue;
        const qty = 1 + acak(3);
        lines.push({
          productId: p.id,
          name: p.name,
          sku: p.sku ?? null,
          hargaJual: Number(p.hargaJual) || 0,
          hargaModal: Number(p.hargaModal) || 0,
          qty
        });
        terjual.set(p.id, (terjual.get(p.id) ?? 0) + qty);
      }
      if (lines.length === 0) continue;

      // Diskon sesekali, supaya kolom diskon di laporan tidak selalu nol.
      const diskon = acak(5) === 0 ? 2000 : 0;
      const totals = computeTotals(lines, { discount: diskon });
      const ref = db.collection("transactions").doc();
      const tunai = metode === "cash" ? Math.ceil(totals.total / 5000) * 5000 : null;

      batch.set(ref, {
        receiptNumber: `TRX-${capHari(waktu)}-${ekor(ref.id)}`,
        cashierUid: kasir.uid,
        cashierName: kasir.nama,
        paymentMethod: metode,
        cashReceived: tunai,
        change: tunai === null ? null : tunai - totals.total,
        qrisReference: metode === "qris" ? `QR-${1000 + acak(9000)}` : null,
        cardReference: metode === "card" ? String(100000 + acak(900000)) : null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        total: totals.total,
        itemCount: lines.reduce((s, l) => s + l.qty, 0),
        lines,
        createdAt: admin.firestore.Timestamp.fromDate(waktu),
        contoh: true
      });
      jumlahTrx++;

      if (++menunggu >= 400) { await batch.commit(); batch = db.batch(); menunggu = 0; }
    }
  }
  if (menunggu > 0) await batch.commit();
  console.log(`  ${jumlahTrx} struk tercatat`);

  // ── 3. Stok disesuaikan dengan yang sudah "terjual" ─────────────────────
  console.log("Menyesuaikan stok dengan penjualan…");
  batch = db.batch();
  menunggu = 0;
  for (const [productId, qty] of terjual) {
    const p = produk.find((x) => x.id === productId);
    const sisa = Math.max(0, (Number(p.stok) || 0) - qty);
    batch.update(db.collection("products").doc(productId), { stok: sisa });
    if (++menunggu >= 400) { await batch.commit(); batch = db.batch(); menunggu = 0; }
  }
  if (menunggu > 0) await batch.commit();
  console.log(`  ${terjual.size} produk stoknya diperbarui`);

  // ── 4. Pengeluaran: restock + operasional ───────────────────────────────
  console.log("Mencatat pengeluaran…");
  batch = db.batch();
  let jumlahBiaya = 0;
  for (let hari = HARI_KE_BELAKANG; hari >= 0; hari -= 3) {
    const p = pilih(produk);
    const qty = 12 + acak(40);
    const waktu = waktuBelanja(hari);
    batch.set(db.collection("expenses").doc(), {
      type: "restock",
      productId: p.id,
      productName: p.name,
      qty,
      hargaModal: Number(p.hargaModal) || 0,
      amount: (Number(p.hargaModal) || 0) * qty,
      note: "kulakan rutin",
      createdBy: "contoh-admin",
      createdAt: admin.firestore.Timestamp.fromDate(waktu),
      contoh: true
    });
    jumlahBiaya++;
  }
  for (const [nama, nilai] of [["Listrik & air toko", 185000], ["Gaji harian", 150000], ["Sewa tempat", 1200000]]) {
    batch.set(db.collection("expenses").doc(), {
      type: "operasional",
      productId: null,
      qty: null,
      amount: nilai,
      note: nama,
      createdBy: "contoh-admin",
      createdAt: admin.firestore.Timestamp.fromDate(waktuBelanja(acak(HARI_KE_BELAKANG))),
      contoh: true
    });
    jumlahBiaya++;
  }
  await batch.commit();
  console.log(`  ${jumlahBiaya} pengeluaran tercatat`);

  // ── 5. Pesanan online di berbagai tahap ─────────────────────────────────
  console.log("Membuat pesanan online…");
  const TAHAP = ["menunggu_bayar", "dibayar", "disiapkan", "siap_diambil", "dikirim", "selesai", "batal"];
  batch = db.batch();
  for (const [i, status] of TAHAP.entries()) {
    const p = pilih(produk);
    const qty = 1 + acak(3);
    const lines = [{
      productId: p.id, name: p.name, sku: p.sku ?? null,
      hargaJual: Number(p.hargaJual) || 0, hargaModal: Number(p.hargaModal) || 0, qty
    }];
    const totals = computeTotals(lines);
    const antar = i % 2 === 0;
    const ongkir = antar ? 10000 : 0;
    const waktu = waktuBelanja(i);
    const ref = db.collection("orders").doc();

    batch.set(ref, {
      orderNumber: `ORD-${capHari(waktu)}-${ekor(ref.id)}`,
      status,
      customerUid: "contoh-pembeli",
      customerName: "Pembeli Contoh",
      customerPhone: "08120000000",
      pengiriman: antar
        ? { cara: "delivery", zona: "dalam_kota", alamat: "Jl. Melati No. 12, RT 03 RW 05, Sleman", catatan: "", ongkir }
        : { cara: "pickup", zona: null, alamat: null, catatan: "", ongkir: 0 },
      lines,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      ongkir,
      total: totals.total + ongkir,
      paymentMethod: status === "menunggu_bayar" ? null : "qris",
      paymentRef: status === "menunggu_bayar" ? null : `QR-${1000 + acak(9000)}`,
      riwayatStatus: [{ status, pada: waktu.toISOString(), oleh: "contoh-admin" }],
      expiresAt: admin.firestore.Timestamp.fromDate(new Date(waktu.getTime() + 60 * 60000)),
      createdAt: admin.firestore.Timestamp.fromDate(waktu),
      updatedAt: admin.firestore.Timestamp.fromDate(waktu),
      contoh: true
    });
  }
  await batch.commit();
  console.log(`  ${TAHAP.length} pesanan dibuat, satu untuk tiap status`);

  console.log("\nSelesai. Buka aplikasinya dan login dengan akun aslimu.");
  console.log("Menghapusnya lagi: node scripts/isi-contoh.js --bersihkan");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("\nGagal:", e?.message ?? e);
  process.exit(1);
});
