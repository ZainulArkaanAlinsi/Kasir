/**
 * Uji M11 — siklus hidup pesanan online.
 *
 * Dua hal yang paling mudah salah pada modul ini, dan keduanya menghabiskan
 * uang toko kalau lolos: pesanan yang berpindah status lewat jalan pintas
 * (mis. jadi "selesai" tanpa pernah dibayar), dan stok yang tidak kembali
 * ke rak saat pesanan batal.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "kasirone-dev";
process.env.ORDER_EXPIRY_MINUTES ??= "60";

const { initFirebase, getDb } = await import("../server/services/firebase.js");
const O = await import("../server/services/order.service.js");

initFirebase();
const db = getDb();

const PEMBELI = { uid: "pembeli-1", name: "Budi", phone: "08123456789" };
const AKTOR_PEMBELI = { uid: "pembeli-1", role: "customer" };
const AKTOR_ADMIN = { uid: "admin-1", role: "admin" };
const ALAMAT = "Jl. Melati No. 12, RT 03 RW 05, Sleman";

async function bersihkan(nama) {
  const snap = await db.collection(nama).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function seed(stok = 10) {
  await db.collection("products").doc("ord-p1").set({
    name: "Top Kopi Aren", sku: "8998866200073", category: "Minuman",
    hargaJual: 6500, hargaModal: 4800, stok, stokDipesan: 0, stokMinimum: 5, aktif: true
  });
}

const produk = async () => (await db.collection("products").doc("ord-p1").get()).data();
const pesan = (qty = 2, kirim = { cara: "pickup" }) =>
  O.buatPesanan({ items: [{ productId: "ord-p1", qty }], pengiriman: kirim, pelanggan: PEMBELI });

test.beforeEach(async () => {
  await Promise.all([bersihkan("products"), bersihkan("orders")]);
  await seed();
});

test("memesan mengunci stok, belum memotongnya", async () => {
  const o = await pesan(3);
  const p = await produk();

  assert.equal(o.status, O.STATUS.MENUNGGU_BAYAR);
  // Ekor nomor diambil dari id dokumen, bukan angka acak, supaya dua pesanan
  // pada hari yang sama tidak pernah bernomor kembar.
  assert.match(o.orderNumber, /^ORD-\d{8}-[A-Z0-9]{6}$/);
  assert.equal(p.stok, 10, "barang masih di rak sampai pesanan selesai");
  assert.equal(p.stokDipesan, 3);
  assert.equal(o.lines[0].hargaModal, 4800, "harga modal ikut ter-snapshot");
});

test("ambil di toko tidak dikenai ongkir, dikirim dikenai", async () => {
  const ambil = await pesan(1, { cara: "pickup" });
  assert.equal(ambil.ongkir, 0);
  assert.equal(ambil.pengiriman.alamat, null, "alamat tidak diminta untuk ambil sendiri");

  await bersihkan("orders");
  const kirim = await pesan(1, { cara: "delivery", zona: "dalam_kota", alamat: ALAMAT });
  assert.ok(kirim.ongkir > 0);
  assert.equal(kirim.total, kirim.subtotal - kirim.discount + kirim.tax + kirim.ongkir);
});

test("pengiriman tanpa alamat ditolak", async () => {
  await assert.rejects(() => pesan(1, { cara: "delivery", zona: "dalam_kota" }));
  await assert.rejects(() => pesan(1, { cara: "delivery", alamat: "pendek" }));
});

test("JALAN PINTAS DITOLAK: belum dibayar tidak bisa langsung selesai", async () => {
  const o = await pesan(2);
  await assert.rejects(
    () => O.ubahStatus(o.id, O.STATUS.SELESAI, AKTOR_ADMIN),
    (e) => e.code === "INVALID_TRANSITION"
  );

  const p = await produk();
  assert.equal(p.stok, 10, "stok tidak boleh terpotong oleh transisi yang ditolak");
  assert.equal(p.stokDipesan, 2, "kunci tetap utuh");
});

test("alur wajar: bayar, siapkan, kirim, selesai", async () => {
  const o = await pesan(2);
  await O.ubahStatus(o.id, O.STATUS.DIBAYAR, AKTOR_ADMIN, { paymentMethod: "qris", paymentRef: "KSR-1" });
  await O.ubahStatus(o.id, O.STATUS.DISIAPKAN, AKTOR_ADMIN);
  await O.ubahStatus(o.id, O.STATUS.DIKIRIM, AKTOR_ADMIN);
  await O.ubahStatus(o.id, O.STATUS.SELESAI, AKTOR_ADMIN);

  const p = await produk();
  assert.equal(p.stok, 8, "barang baru keluar toko saat pesanan selesai");
  assert.equal(p.stokDipesan, 0, "kunci dilepas bersamaan");

  const akhir = await O.ambilPesanan(o.id, AKTOR_ADMIN);
  assert.equal(akhir.status, O.STATUS.SELESAI);
  assert.equal(akhir.paymentRef, "KSR-1");
  assert.equal(akhir.riwayatStatus.length, 5, "setiap perpindahan tercatat");
});

test("RACE CONDITION: dua penyelesaian bersamaan hanya memotong stok sekali", async () => {
  const o = await pesan(3);
  await O.ubahStatus(o.id, O.STATUS.DIBAYAR, AKTOR_ADMIN);
  await O.ubahStatus(o.id, O.STATUS.DISIAPKAN, AKTOR_ADMIN);
  await O.ubahStatus(o.id, O.STATUS.SIAP_DIAMBIL, AKTOR_ADMIN);

  // Admin menekan "Sudah diambil" dua kali beruntun — hal paling lumrah
  // terjadi saat jaringan terasa lambat. Dulu keduanya membaca status lama,
  // sama-sama lolos tabel transisi, dan stok terpotong dua kali untuk satu
  // pesanan yang sama.
  const hasil = await Promise.allSettled([
    O.ubahStatus(o.id, O.STATUS.SELESAI, AKTOR_ADMIN),
    O.ubahStatus(o.id, O.STATUS.SELESAI, AKTOR_ADMIN)
  ]);

  const berhasil = hasil.filter((h) => h.status === "fulfilled");
  assert.equal(berhasil.length, 1, "hanya satu panggilan yang boleh menyelesaikan pesanan");

  const p = await produk();
  assert.equal(p.stok, 7, "stok berkurang tepat sekali, bukan dua kali");
  assert.equal(p.stokDipesan, 0);
});

test("RACE CONDITION: batal bersamaan tidak melepas kunci dua kali", async () => {
  const o = await pesan(4);

  const hasil = await Promise.allSettled([
    O.ubahStatus(o.id, O.STATUS.BATAL, AKTOR_ADMIN),
    O.ubahStatus(o.id, O.STATUS.BATAL, AKTOR_ADMIN)
  ]);

  assert.equal(hasil.filter((h) => h.status === "fulfilled").length, 1);

  const p = await produk();
  assert.equal(p.stok, 10, "stok fisik tidak pernah disentuh saat batal");
  assert.equal(p.stokDipesan, 0, "kunci dilepas, dan tidak menjadi minus");
});

test("membatalkan pesanan mengembalikan stok ke rak", async () => {
  const o = await pesan(4);
  await O.ubahStatus(o.id, O.STATUS.BATAL, AKTOR_PEMBELI);

  const p = await produk();
  assert.equal(p.stok, 10);
  assert.equal(p.stokDipesan, 0);
});

test("pelanggan tidak bisa membatalkan pesanan yang sudah dibayar", async () => {
  const o = await pesan(2);
  await O.ubahStatus(o.id, O.STATUS.DIBAYAR, AKTOR_ADMIN);

  await assert.rejects(
    () => O.ubahStatus(o.id, O.STATUS.BATAL, AKTOR_PEMBELI),
    (e) => e.code === "CANCEL_NOT_ALLOWED"
  );
});

test("pelanggan tidak bisa menyentuh pesanan orang lain", async () => {
  const o = await pesan(1);
  const orangLain = { uid: "pembeli-9", role: "customer" };

  await assert.rejects(() => O.ubahStatus(o.id, O.STATUS.BATAL, orangLain), (e) => e.status === 403);
  // Dijawab 404, bukan 403, supaya keberadaan pesanan orang lain tidak bocor.
  await assert.rejects(() => O.ambilPesanan(o.id, orangLain), (e) => e.status === 404);
});

test("pelanggan tidak bisa menaikkan status pesanannya sendiri", async () => {
  const o = await pesan(1);
  await assert.rejects(
    () => O.ubahStatus(o.id, O.STATUS.DIBAYAR, AKTOR_PEMBELI),
    (e) => e.status === 403
  );
});

test("pesanan lewat batas waktu dibersihkan dan stoknya kembali", async () => {
  const o = await pesan(3);
  // Majukan waktu kedaluwarsa ke masa lalu.
  await db.collection("orders").doc(o.id).update({
    expiresAt: new Date(Date.now() - 60000)
  });

  const hasil = await O.bersihkanKedaluwarsa();
  assert.ok(hasil.diproses >= 1);

  const p = await produk();
  assert.equal(p.stokDipesan, 0, "kunci dilepas");
  assert.equal(p.stok, 10, "stok fisik utuh, barang tidak pernah keluar");

  const akhir = await O.ambilPesanan(o.id, AKTOR_ADMIN);
  assert.equal(akhir.status, O.STATUS.KEDALUWARSA);
});

test("memesan melebihi stok tersedia ditolak, tidak ada pesanan tertinggal", async () => {
  await assert.rejects(() => pesan(99), (e) => e.code === "INSUFFICIENT_STOCK");

  const p = await produk();
  assert.equal(p.stokDipesan, 0, "tidak ada kunci yang tertinggal");
  assert.equal((await db.collection("orders").get()).size, 0, "tidak ada pesanan hantu");
});

test("pelanggan hanya melihat pesanannya sendiri di daftar", async () => {
  await pesan(1);
  await O.buatPesanan({
    items: [{ productId: "ord-p1", qty: 1 }],
    pengiriman: { cara: "pickup" },
    pelanggan: { uid: "pembeli-lain", name: "Siti", phone: null }
  });

  const milikBudi = await O.daftarPesanan({ customerUid: "pembeli-1" });
  assert.equal(milikBudi.length, 1);
  assert.equal(milikBudi[0].customerUid, "pembeli-1");

  const semua = await O.daftarPesanan();
  assert.equal(semua.length, 2, "staf melihat keduanya");
});
