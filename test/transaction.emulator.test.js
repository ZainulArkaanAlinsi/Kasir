/**
 * Uji integrasi transaksi terhadap Firestore Emulator.
 *
 * Fokus utama: RACE CONDITION. Ini satu-satunya cara membuktikan klaim
 * "dua kasir tidak bisa membuat stok minus" — tidak cukup dengan membaca kode.
 *
 * Jalankan lewat: npm run test:emulator
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "kasirone-dev";

const { initFirebase, getDb, admin } = await import("../server/services/firebase.js");
const { createTransaction } = await import("../server/services/transaction.service.js");

initFirebase();
const db = getDb();

const KASIR = { uid: "kasir-1", name: "Nabila", email: "nabila@toko.test" };

/** Mengosongkan koleksi agar tiap test berangkat dari kondisi bersih. */
async function bersihkan(nama) {
  const snap = await db.collection(nama).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function seedProduk(id, data) {
  await db.collection("products").doc(id).set({
    name: data.name ?? "Indomie Goreng",
    sku: data.sku ?? "8998866200011",
    category: "Makanan",
    hargaJual: data.hargaJual ?? 3500,
    hargaModal: data.hargaModal ?? 2800,
    stok: data.stok,
    stokMinimum: 5,
    aktif: data.aktif ?? true
  });
}

test.beforeEach(async () => {
  await Promise.all([bersihkan("products"), bersihkan("transactions"), bersihkan("auditLogs")]);
});

test("transaksi normal mengurangi stok dan menyimpan snapshot harga", async () => {
  await seedProduk("p1", { stok: 10 });

  const trx = await createTransaction({
    items: [{ productId: "p1", qty: 3 }],
    paymentMethod: "cash",
    cashReceived: 50000,
    cashier: KASIR
  });

  assert.equal(trx.subtotal, 10500);
  assert.equal(trx.tax, Math.round(10500 * 0.11));
  assert.equal(trx.total, 10500 + trx.tax);
  assert.equal(trx.change, 50000 - trx.total);
  assert.equal(trx.lines[0].hargaModal, 2800, "harga modal wajib ikut ter-snapshot");

  const after = await db.collection("products").doc("p1").get();
  assert.equal(after.data().stok, 7);
});

test("harga dari browser DIABAIKAN, server memakai harga database", async () => {
  await seedProduk("p1", { stok: 10, hargaJual: 3500 });

  // Browser jahat mengirim harga 1 rupiah.
  const trx = await createTransaction({
    items: [{ productId: "p1", qty: 2, hargaJual: 1, total: 2 }],
    paymentMethod: "card",
    cashier: KASIR
  });

  assert.equal(trx.lines[0].hargaJual, 3500, "server harus pakai harga asli, bukan kiriman browser");
  assert.equal(trx.subtotal, 7000);
});

test("stok kurang ditolak dan tidak mengubah apa pun", async () => {
  await seedProduk("p1", { stok: 2 });

  await assert.rejects(
    () => createTransaction({ items: [{ productId: "p1", qty: 5 }], paymentMethod: "card", cashier: KASIR }),
    (err) => err.code === "INSUFFICIENT_STOCK"
  );

  const after = await db.collection("products").doc("p1").get();
  assert.equal(after.data().stok, 2, "stok tidak boleh berubah saat transaksi gagal");
  assert.equal((await db.collection("transactions").get()).size, 0);
});

test("uang tunai kurang ditolak", async () => {
  await seedProduk("p1", { stok: 10 });
  await assert.rejects(
    () => createTransaction({
      items: [{ productId: "p1", qty: 1 }], paymentMethod: "cash", cashReceived: 100, cashier: KASIR
    }),
    (err) => err.code === "INSUFFICIENT_CASH"
  );
  assert.equal((await db.collection("products").doc("p1").get()).data().stok, 10);
});

test("produk tidak ada ditolak", async () => {
  await assert.rejects(
    () => createTransaction({ items: [{ productId: "hantu", qty: 1 }], paymentMethod: "card", cashier: KASIR }),
    (err) => err.status === 404
  );
});

test("RACE CONDITION: 12 kasir rebutan stok 10, tidak boleh minus", async () => {
  await seedProduk("p1", { stok: 10 });

  // 12 checkout serentak, masing-masing 1 pcs.
  const hasil = await Promise.allSettled(
    Array.from({ length: 12 }, () => createTransaction({
      items: [{ productId: "p1", qty: 1 }], paymentMethod: "card", cashier: KASIR
    }))
  );

  const sukses = hasil.filter((r) => r.status === "fulfilled").length;
  const gagal = hasil.filter((r) => r.status === "rejected").length;
  const stokAkhir = (await db.collection("products").doc("p1").get()).data().stok;
  const jumlahTrx = (await db.collection("transactions").get()).size;

  console.log(`      -> sukses=${sukses} gagal=${gagal} stokAkhir=${stokAkhir} transaksi=${jumlahTrx}`);

  assert.equal(sukses, 10, "tepat 10 transaksi boleh berhasil");
  assert.equal(gagal, 2, "2 sisanya harus ditolak");
  assert.equal(stokAkhir, 0, "stok harus habis pas, tidak minus");
  assert.ok(stokAkhir >= 0, "stok TIDAK BOLEH negatif");
  assert.equal(jumlahTrx, 10, "jumlah dokumen transaksi harus sama dengan yang sukses");
});

test("dua produk, satu kurang: seluruh transaksi dibatalkan", async () => {
  await seedProduk("p1", { stok: 10 });
  await seedProduk("p2", { stok: 1, sku: "8998866200028", name: "Teh Botol" });

  await assert.rejects(
    () => createTransaction({
      items: [{ productId: "p1", qty: 2 }, { productId: "p2", qty: 5 }],
      paymentMethod: "card", cashier: KASIR
    }),
    (err) => err.code === "INSUFFICIENT_STOCK"
  );

  assert.equal((await db.collection("products").doc("p1").get()).data().stok, 10,
    "produk yang cukup pun tidak boleh berkurang bila transaksi batal");
});

test("audit log tercatat untuk tiap transaksi sukses", async () => {
  await seedProduk("p1", { stok: 5 });
  await createTransaction({ items: [{ productId: "p1", qty: 1 }], paymentMethod: "qris", qrisReference: "INV-1", cashier: KASIR });

  const logs = await db.collection("auditLogs").where("action", "==", "CREATE_TRANSACTION").get();
  assert.equal(logs.size, 1);
  assert.equal(logs.docs[0].data().uid, KASIR.uid);
});
