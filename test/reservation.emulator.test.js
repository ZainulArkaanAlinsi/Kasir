/**
 * Uji M8 — pemisahan stok tersedia dan stok dipesan.
 *
 * Yang dibuktikan di sini adalah risiko paling mahal dari membuka etalase
 * online di atas toko fisik: satu barang terakhir dijanjikan ke dua orang.
 * Tidak cukup membaca kode untuk memastikannya, jadi kasirnya dan pembeli
 * online benar-benar diadu berebut stok yang sama.
 *
 * Jalankan lewat: npm run test:emulator
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "kasirone-dev";

const { initFirebase, getDb } = await import("../server/services/firebase.js");
const { kunciStok, lepasKunci, selesaikanKunci } = await import("../server/services/reservation.service.js");
const { createTransaction } = await import("../server/services/transaction.service.js");

initFirebase();
const db = getDb();
const KASIR = { uid: "kasir-1", name: "Nabila", email: "nabila@toko.test" };

async function bersihkan(nama) {
  const snap = await db.collection(nama).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function seed(id, { stok, stokDipesan = 0 }) {
  await db.collection("products").doc(id).set({
    name: "Chitato Original", sku: "8998866200059", category: "Snack",
    hargaJual: 11500, hargaModal: 9000, stok, stokDipesan, stokMinimum: 5, aktif: true
  });
}

const baca = async (id) => (await db.collection("products").doc(id).get()).data();

test.beforeEach(async () => {
  await Promise.all([bersihkan("products"), bersihkan("transactions"), bersihkan("auditLogs")]);
});

test("mengunci stok menaikkan stokDipesan tanpa menyentuh stok fisik", async () => {
  await seed("resv-p1", { stok: 10 });

  const lines = await kunciStok([{ productId: "resv-p1", qty: 3 }]);
  const p = await baca("resv-p1");

  assert.equal(p.stok, 10, "stok fisik belum boleh berkurang, barang masih di rak");
  assert.equal(p.stokDipesan, 3);
  assert.equal(lines[0].hargaModal, 9000, "harga modal wajib ter-snapshot");
});

test("KASIR TIDAK BISA menjual barang yang sudah dikunci pesanan online", async () => {
  await seed("resv-p1", { stok: 5 });
  await kunciStok([{ productId: "resv-p1", qty: 4 }]);   // 1 tersisa

  // Kasir mencoba menjual 3 — fisik ada 5, tapi yang boleh dijual hanya 1.
  await assert.rejects(
    () => createTransaction({
      items: [{ productId: "resv-p1", qty: 3 }], paymentMethod: "card", cashier: KASIR
    }),
    (err) => err.code === "INSUFFICIENT_STOCK"
  );

  const p = await baca("resv-p1");
  assert.equal(p.stok, 5, "transaksi gagal tidak boleh mengubah apa pun");
  assert.equal(p.stokDipesan, 4);
});

test("kasir tetap boleh menjual sisa yang belum dikunci", async () => {
  await seed("resv-p1", { stok: 5 });
  await kunciStok([{ productId: "resv-p1", qty: 4 }]);

  await createTransaction({ items: [{ productId: "resv-p1", qty: 1 }], paymentMethod: "card", cashier: KASIR });

  const p = await baca("resv-p1");
  assert.equal(p.stok, 4, "stok fisik berkurang satu");
  assert.equal(p.stokDipesan, 4, "kunci pesanan online tidak terganggu");
});

test("pesanan online tidak bisa mengunci lebih dari yang tersedia", async () => {
  await seed("resv-p1", { stok: 3, stokDipesan: 2 });   // tersedia = 1

  await assert.rejects(
    () => kunciStok([{ productId: "resv-p1", qty: 2 }]),
    (err) => err.code === "INSUFFICIENT_STOCK"
  );
});

test("membatalkan pesanan mengembalikan barang ke rak", async () => {
  await seed("resv-p1", { stok: 10 });
  await kunciStok([{ productId: "resv-p1", qty: 4 }]);

  await lepasKunci([{ productId: "resv-p1", qty: 4 }]);

  const p = await baca("resv-p1");
  assert.equal(p.stok, 10);
  assert.equal(p.stokDipesan, 0, "kunci dilepas seluruhnya");
});

test("pembatalan ganda tidak membuat stokDipesan negatif", async () => {
  await seed("resv-p1", { stok: 10 });
  await kunciStok([{ productId: "resv-p1", qty: 2 }]);

  await lepasKunci([{ productId: "resv-p1", qty: 2 }]);
  await lepasKunci([{ productId: "resv-p1", qty: 2 }]);   // tombol batal diklik dua kali

  const p = await baca("resv-p1");
  assert.equal(p.stokDipesan, 0, "tidak boleh minus");
  assert.ok(p.stokDipesan >= 0);
});

test("menyelesaikan pesanan mengurangi stok fisik DAN melepas kunci", async () => {
  await seed("resv-p1", { stok: 10 });
  await kunciStok([{ productId: "resv-p1", qty: 3 }]);

  await selesaikanKunci([{ productId: "resv-p1", qty: 3 }]);

  const p = await baca("resv-p1");
  assert.equal(p.stok, 7, "barang benar-benar keluar toko");
  assert.equal(p.stokDipesan, 0);
});

test("BALAPAN: 1 kasir + 8 pesanan online berebut stok 5, tidak boleh lebih terjual", async () => {
  await seed("resv-p1", { stok: 5 });

  // Kasir menjual 2 pada saat yang sama dengan 8 pesanan online masing-masing 1.
  const semua = await Promise.allSettled([
    createTransaction({ items: [{ productId: "resv-p1", qty: 2 }], paymentMethod: "card", cashier: KASIR }),
    ...Array.from({ length: 8 }, () => kunciStok([{ productId: "resv-p1", qty: 1 }]))
  ]);

  const sukses = semua.filter((r) => r.status === "fulfilled").length;
  const p = await baca("resv-p1");
  const terpakai = (5 - p.stok) + p.stokDipesan;   // yang terjual + yang dikunci

  console.log(`      -> sukses=${sukses} stok=${p.stok} dipesan=${p.stokDipesan} terpakai=${terpakai}`);

  assert.ok(terpakai <= 5, `tidak boleh menjanjikan lebih dari 5 unit, terpakai ${terpakai}`);
  assert.ok(p.stok >= 0, "stok fisik tidak boleh negatif");
  assert.ok(p.stokDipesan >= 0, "kunci tidak boleh negatif");
  assert.ok(p.stok - p.stokDipesan >= 0, "stok tersedia tidak boleh negatif");
});

test("produk nonaktif tidak bisa dipesan lewat etalase", async () => {
  await db.collection("products").doc("resv-p1").set({
    name: "Ditarik", sku: "999", hargaJual: 1000, hargaModal: 500, stok: 10, stokDipesan: 0, aktif: false
  });

  await assert.rejects(
    () => kunciStok([{ productId: "resv-p1", qty: 1 }]),
    (err) => err.code === "INSUFFICIENT_STOCK"
  );
});
