/**
 * Uji alur lengkap mode demo.
 *
 * Mode demo adalah satu-satunya cara menjalankan aplikasi tanpa project
 * Firebase, jadi ia harus benar-benar bekerja — bukan sekadar "tidak error".
 * localStorage dipalsukan seadanya agar modul browser bisa diuji di Node.
 */
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

const { createDemoApi } = await import("../public/js/api/demo.api.js");

test.beforeEach(() => store.clear());

test("seed produk tersedia dan punya harga modal", async () => {
  const api = createDemoApi();
  const produk = await api.listProducts();

  assert.equal(produk.length, 10);
  assert.ok(produk.every((p) => p.hargaModal > 0), "semua produk wajib punya harga modal");
  assert.ok(produk.every((p) => p.hargaJual >= p.hargaModal), "harga jual tidak boleh di bawah modal");
  assert.ok(produk.every((p) => p.stokMinimum > 0), "stok minimum wajib ada (pengganti angka 8)");
});

test("scan barcode menemukan produk", async () => {
  const api = createDemoApi();
  const p = await api.findBySku("8998866200073");
  assert.equal(p.name, "Top Kopi Aren");
});

test("scan barcode tak terdaftar melempar error yang jelas", async () => {
  const api = createDemoApi();
  await assert.rejects(() => api.findBySku("0000000000000"), (e) => e.code === "NOT_FOUND");
});

test("alur penuh: jual -> stok berkurang -> laporan benar", async () => {
  const api = createDemoApi();
  const produk = await api.listProducts();
  const indomie = produk.find((p) => p.name === "Indomie Goreng");   // 3500 / modal 2800, stok 42
  const kopi = produk.find((p) => p.name === "Top Kopi Aren");        // 6500 / modal 4800, stok 40

  const trx = await api.createTransaction({
    items: [{ productId: indomie.id, qty: 23 }, { productId: kopi.id, qty: 40 }],
    paymentMethod: "cash",
    cashReceived: 500000
  });

  const subtotal = 3500 * 23 + 6500 * 40;                            // 80.500 + 260.000
  assert.equal(trx.subtotal, subtotal);
  assert.equal(trx.tax, Math.round(subtotal * 0.11));
  assert.equal(trx.total, subtotal + trx.tax);
  assert.equal(trx.change, 500000 - trx.total);
  assert.equal(trx.itemCount, 63);

  const setelah = await api.listProducts();
  assert.equal(setelah.find((p) => p.id === indomie.id).stok, 42 - 23);
  assert.equal(setelah.find((p) => p.id === kopi.id).stok, 40 - 40);

  const laporan = await api.getReport({ period: "week" });
  assert.equal(laporan.pemasukan, trx.total);
  assert.equal(laporan.jumlahTransaksi, 1);
  assert.equal(laporan.totalItemTerjual, 63);

  // Inilah bentuk laporan yang diminta: "Indomie 23, Kopi Aren 40".
  const terlaris = laporan.produkTerjual;
  assert.equal(terlaris[0].name, "Top Kopi Aren");
  assert.equal(terlaris[0].qty, 40);
  assert.equal(terlaris[1].name, "Indomie Goreng");
  assert.equal(terlaris[1].qty, 23);

  assert.equal(laporan.labaKotor, (3500 - 2800) * 23 + (6500 - 4800) * 40); // 16.100 + 68.000
});

test("stok kurang ditolak dan tidak mengubah stok", async () => {
  const api = createDemoApi();
  const tissue = (await api.listProducts()).find((p) => p.name === "Tissue Soft"); // stok 5

  await assert.rejects(
    () => api.createTransaction({ items: [{ productId: tissue.id, qty: 99 }], paymentMethod: "card" }),
    (e) => e.code === "INSUFFICIENT_STOCK"
  );
  assert.equal((await api.listProducts()).find((p) => p.id === tissue.id).stok, 5);
});

test("uang tunai kurang ditolak", async () => {
  const api = createDemoApi();
  const p = (await api.listProducts())[0];
  await assert.rejects(
    () => api.createTransaction({ items: [{ productId: p.id, qty: 1 }], paymentMethod: "cash", cashReceived: 1 }),
    (e) => e.code === "INSUFFICIENT_CASH"
  );
});

test("restock menambah stok DAN mencatat pengeluaran sekaligus", async () => {
  const api = createDemoApi();
  const chitato = (await api.listProducts()).find((p) => p.name === "Chitato Original"); // stok 8, modal 9000

  const hasil = await api.restock({ productId: chitato.id, qty: 20 });
  assert.equal(hasil.stokBaru, 28);
  assert.equal(hasil.amount, 9000 * 20);

  const pengeluaran = await api.listExpenses();
  assert.equal(pengeluaran.length, 1);
  assert.equal(pengeluaran[0].amount, 180000);

  const laporan = await api.getReport({ period: "week" });
  assert.equal(laporan.pengeluaran, 180000);
  assert.equal(laporan.labaBersih, laporan.labaKotor - 180000);
});

test("harga jual di bawah modal ditolak saat tambah produk", async () => {
  const api = createDemoApi();
  await assert.rejects(
    () => api.createProduct({ name: "Rugi", sku: "999", category: "X", hargaJual: 1000, hargaModal: 5000, stok: 1 }),
    (e) => e.code === "PRICE_BELOW_COST"
  );
});

test("SKU duplikat ditolak (barcode harus unik)", async () => {
  const api = createDemoApi();
  await assert.rejects(
    () => api.createProduct({ name: "Kembar", sku: "8998866200011", category: "X", hargaJual: 5000, hargaModal: 1000, stok: 1 }),
    (e) => e.code === "DUPLICATE_SKU"
  );
});
