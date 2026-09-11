/**
 * Implementasi API mode demo (tanpa Firebase), memakai localStorage.
 *
 * Modul ini sengaja meniru ATURAN yang sama dengan server: harga selalu
 * dibaca ulang dari "database" lokal, stok dicek sebelum dikurangi, dan
 * total dihitung dengan modul uang bersama. Dengan begitu perilaku demo
 * tidak menyesatkan — kalau sesuatu ditolak di produksi, ditolak juga di sini.
 *
 * Data demo TIDAK PERNAH bercampur dengan data Firestore: prefiks kunci
 * localStorage berbeda dan mode ditentukan eksplisit saat login.
 */
import { computeTotals, computeChange, lineProfit } from "../shared/money.js";
import { stokTersedia } from "../shared/product.js";

const KEY = {
  products: "kasirone_demo_products",
  trx: "kasirone_demo_transactions",
  exp: "kasirone_demo_expenses",
  ord: "kasirone_demo_orders"
};

/** Barcode memakai format EAN-13 agar realistis saat diuji dengan scanner asli. */
const SEED_PRODUCTS = [
  { name: "Indomie Goreng", sku: "8998866200011", category: "Makanan", hargaJual: 3500, hargaModal: 2800, stok: 42, stokMinimum: 10 },
  { name: "Teh Botol Sosro", sku: "8998866200028", category: "Minuman", hargaJual: 4500, hargaModal: 3600, stok: 28, stokMinimum: 10 },
  { name: "Aqua 600ml", sku: "8998866200035", category: "Minuman", hargaJual: 4000, hargaModal: 3100, stok: 18, stokMinimum: 12 },
  { name: "Roti Cokelat", sku: "8998866200042", category: "Makanan", hargaJual: 8500, hargaModal: 6200, stok: 12, stokMinimum: 8 },
  { name: "Chitato Original", sku: "8998866200059", category: "Snack", hargaJual: 11500, hargaModal: 9000, stok: 8, stokMinimum: 10 },
  { name: "SilverQueen", sku: "8998866200066", category: "Snack", hargaJual: 13000, hargaModal: 10500, stok: 25, stokMinimum: 8 },
  { name: "Top Kopi Aren", sku: "8998866200073", category: "Minuman", hargaJual: 6500, hargaModal: 4800, stok: 40, stokMinimum: 15 },
  { name: "Susu UHT", sku: "8998866200080", category: "Minuman", hargaJual: 7500, hargaModal: 5900, stok: 14, stokMinimum: 10 },
  { name: "Tissue Soft", sku: "8998866200097", category: "Rumah", hargaJual: 9500, hargaModal: 7200, stok: 5, stokMinimum: 8 },
  { name: "Sabun Cair", sku: "8998866200103", category: "Rumah", hargaJual: 14000, hargaModal: 11000, stok: 17, stokMinimum: 6 }
];

const NAMA_HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/**
 * Selisih relatif dua angka. Aturannya harus sama persis dengan
 * bandingkan() di server/services/report.service.js, jika tidak angka di
 * mode demo dan mode live akan berbeda untuk data yang sama.
 *
 * @param {number} sekarang
 * @param {number} sebelumnya
 * @returns {{persen:number|null, arah:"naik"|"turun"|"tetap"}}
 */
function bandingkan(sekarang, sebelumnya) {
  const a = Number(sekarang) || 0;
  const b = Number(sebelumnya) || 0;
  if (a === b) return { persen: 0, arah: "tetap" };
  if (b === 0) return { persen: null, arah: "naik" };
  const persen = Math.round(((a - b) / Math.abs(b)) * 100);
  return { persen, arah: persen >= 0 ? "naik" : "turun" };
}

const baca = (key, fallback) => {
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    return raw ?? fallback;
  } catch {
    return fallback;
  }
};

const tulis = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const idBaru = () => `d${Date.now()}${Math.floor(Math.random() * 1000)}`;

/**
 * Membuat error yang BENTUKNYA sama dengan error dari server, supaya
 * modul UI cukup menangani satu format error saja.
 * @param {string} message
 * @param {string} code
 * @param {object} [details]
 * @returns {Error & {code:string, details?:object}}
 */
function apiError(message, code, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

/**
 * @returns {object} objek API mode demo, antarmukanya identik dengan live API
 */
export function createDemoApi() {
  if (!localStorage.getItem(KEY.products)) {
    tulis(KEY.products, SEED_PRODUCTS.map((p) => ({ id: idBaru(), aktif: true, stokDipesan: 0, ...p })));
  }

  const getProducts = () => baca(KEY.products, []);
  const getTrx = () => baca(KEY.trx, []);
  const getExp = () => baca(KEY.exp, []);

  /**
   * Restock: menambah stok sekaligus mencatat pengeluaran.
   * Didefinisikan sebagai fungsi biasa agar bisa dipanggil ulang oleh
   * createExpense tanpa bergantung pada `this`.
   * @param {{productId:string, qty:number, hargaModalBaru?:number|null, note?:string}} input
   * @returns {Promise<object>}
   */
  async function restock({ productId, qty, hargaModalBaru = null, note = "" }) {
    const products = getProducts();
    const product = products.find((p) => p.id === productId);
    if (!product) throw apiError("Produk tidak ditemukan.", "NOT_FOUND");

    const hargaModal = hargaModalBaru ?? (Number(product.hargaModal) || 0);
    product.stok = (Number(product.stok) || 0) + qty;
    if (hargaModalBaru !== null) product.hargaModal = hargaModalBaru;
    tulis(KEY.products, products);

    const expense = {
      id: idBaru(),
      type: "restock",
      productId,
      productName: product.name,
      qty,
      hargaModal,
      amount: hargaModal * qty,
      note,
      createdAt: new Date().toISOString()
    };
    tulis(KEY.exp, [expense, ...getExp()]);
    return { ...expense, stokBaru: product.stok };
  }

  return {
    mode: "demo",

    me: async () => ({ uid: "demo-user", email: null, role: "admin", name: "Nabila (Demo)" }),

    listProducts: async () => getProducts().filter((p) => p.aktif !== false),

    /**
     * Mode demo sengaja TIDAK memalsukan QR pembayaran. Menampilkan kode QR
     * yang terlihat sungguhan padahal tidak menagih apa pun adalah cara
     * tercepat membuat orang mengira uangnya sudah masuk.
     */
    paymentStatus: async () => ({
      mode: "demo",
      terverifikasi: false,
      lingkungan: "-",
      keterangan: "Mode demo: tidak ada pembayaran sungguhan. QRIS dicatat sebagai simulasi tanpa kode QR."
    }),

    createQris: async ({ orderId }) => ({
      mode: "demo",
      orderId,
      qrImage: null,
      terverifikasi: false,
      keterangan: "Mode demo — tidak ada uang yang berpindah.",
      expiresAt: null
    }),

    qrisStatus: async () => ({ status: "tidak-diketahui", raw: "demo" }),

    /** Katalog demo memakai penyaringan yang sama dengan server. */
    listKatalog: async () => getProducts()
      .filter((p) => p.aktif !== false)
      .map((p) => {
        const tersedia = stokTersedia(p);
        return {
          id: p.id, name: p.name, sku: p.sku ?? null, category: p.category ?? null,
          hargaJual: Number(p.hargaJual) || 0, imageUrl: p.imageUrl ?? null,
          tersedia, habis: tersedia <= 0
        };
      }),

    opsiPengiriman: async () => ({
      cara: ["pickup", "delivery"],
      zona: ["dalam_kota", "luar_kota"],
      tarif: { pickup: 0, dalam_kota: 10000, luar_kota: 25000 }
    }),

    /**
     * Pesanan mode demo. Aturan penguncian stoknya ditiru dari server:
     * memesan menaikkan stokDipesan tanpa memotong stok fisik, sehingga
     * kasir di halaman lain langsung melihat sisa yang boleh dijual.
     */
    buatPesanan: async ({ items, pengiriman, telepon }) => {
      const products = getProducts();
      const lines = [];
      const kurang = [];

      for (const item of items ?? []) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) throw apiError("Produk tidak ditemukan.", "NOT_FOUND");
        const tersedia = stokTersedia(product);
        if (tersedia < item.qty) {
          kurang.push({ name: product.name, diminta: item.qty, tersedia });
          continue;
        }
        lines.push({
          productId: product.id, name: product.name, sku: product.sku,
          hargaJual: Number(product.hargaJual) || 0,
          hargaModal: Number(product.hargaModal) || 0,
          qty: item.qty
        });
      }

      if (kurang.length) {
        const ringkas = kurang.map((k) => `${k.name} (minta ${k.diminta}, tersedia ${k.tersedia})`).join("; ");
        throw apiError(`Stok tidak mencukupi: ${ringkas}.`, "INSUFFICIENT_STOCK", { kurang });
      }
      if (!lines.length) throw apiError("Keranjang tidak boleh kosong.", "EMPTY_CART");

      const cara = pengiriman?.cara === "delivery" ? "delivery" : "pickup";
      if (cara === "delivery" && String(pengiriman?.alamat ?? "").trim().length < 10) {
        throw apiError("Alamat pengiriman wajib diisi minimal 10 karakter.", "BAD_ADDRESS");
      }
      const ongkir = cara === "delivery" ? (pengiriman.zona === "luar_kota" ? 25000 : 10000) : 0;

      for (const line of lines) {
        const product = products.find((p) => p.id === line.productId);
        product.stokDipesan = (Number(product.stokDipesan) || 0) + line.qty;
      }
      tulis(KEY.products, products);

      const totals = computeTotals(lines);
      const pesanan = {
        id: idBaru(),
        orderNumber: `ORD-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(Date.now()).slice(-4)}`,
        status: "menunggu_bayar",
        customerUid: "demo-user", customerName: "Nabila (Demo)", customerPhone: telepon ?? null,
        pengiriman: { cara, zona: pengiriman?.zona ?? null, alamat: pengiriman?.alamat ?? null, catatan: pengiriman?.catatan ?? "", ongkir },
        lines, ...totals, ongkir, total: totals.total + ongkir,
        paymentMethod: null, paymentRef: null,
        riwayatStatus: [{ status: "menunggu_bayar", pada: new Date().toISOString(), oleh: "demo-user" }],
        createdAt: new Date().toISOString()
      };
      tulis(KEY.ord, [pesanan, ...baca(KEY.ord, [])]);
      return pesanan;
    },

    daftarPesanan: async ({ status, limit = 50 } = {}) =>
      baca(KEY.ord, []).filter((o) => !status || o.status === status).slice(0, limit),

    ambilPesanan: async (id) => {
      const o = baca(KEY.ord, []).find((x) => x.id === id);
      if (!o) throw apiError("Pesanan tidak ditemukan.", "NOT_FOUND");
      return o;
    },

    ubahStatusPesanan: async (id, status) => {
      const semua = baca(KEY.ord, []);
      const o = semua.find((x) => x.id === id);
      if (!o) throw apiError("Pesanan tidak ditemukan.", "NOT_FOUND");

      const TRANSISI = {
        menunggu_bayar: ["dibayar", "batal", "kedaluwarsa"],
        dibayar: ["disiapkan", "batal"],
        disiapkan: ["siap_diambil", "dikirim", "batal"],
        siap_diambil: ["selesai", "batal"],
        dikirim: ["selesai"],
        selesai: [], batal: [], kedaluwarsa: []
      };
      if (!(TRANSISI[o.status] ?? []).includes(status)) {
        throw apiError(`Pesanan "${o.status}" tidak bisa menjadi "${status}".`, "INVALID_TRANSITION");
      }

      const products = getProducts();
      const kunciMasih = ["menunggu_bayar", "dibayar", "disiapkan", "siap_diambil", "dikirim"].includes(o.status);

      if (["batal", "kedaluwarsa"].includes(status) && kunciMasih) {
        for (const l of o.lines) {
          const p = products.find((x) => x.id === l.productId);
          if (p) p.stokDipesan = Math.max(0, (Number(p.stokDipesan) || 0) - l.qty);
        }
        tulis(KEY.products, products);
      } else if (status === "selesai") {
        for (const l of o.lines) {
          const p = products.find((x) => x.id === l.productId);
          if (p) {
            p.stok = Math.max(0, (Number(p.stok) || 0) - l.qty);
            p.stokDipesan = Math.max(0, (Number(p.stokDipesan) || 0) - l.qty);
          }
        }
        tulis(KEY.products, products);
      }

      o.status = status;
      o.riwayatStatus.push({ status, pada: new Date().toISOString(), oleh: "demo-user" });
      tulis(KEY.ord, semua);
      return o;
    },

    bersihkanKedaluwarsa: async () => ({ diproses: 0 }),

    findBySku: async (sku) => {
      const kode = String(sku).trim();
      const found = getProducts().find((p) => p.sku === kode && p.aktif !== false);
      if (!found) throw apiError(`Barcode "${kode}" tidak terdaftar.`, "NOT_FOUND");
      return found;
    },

    createProduct: async (data) => {
      const products = getProducts();
      if (products.some((p) => p.sku === data.sku)) {
        throw apiError(`SKU "${data.sku}" sudah dipakai produk lain.`, "DUPLICATE_SKU");
      }
      if (Number(data.hargaJual) < Number(data.hargaModal)) {
        throw apiError("Harga jual tidak boleh lebih kecil dari harga modal.", "PRICE_BELOW_COST");
      }
      const product = { id: idBaru(), aktif: true, stokDipesan: 0, ...data };
      tulis(KEY.products, [product, ...products]);
      return product;
    },

    updateProduct: async (id, data) => {
      const products = getProducts();
      const index = products.findIndex((p) => p.id === id);
      if (index < 0) throw apiError("Produk tidak ditemukan.", "NOT_FOUND");

      const merged = { ...products[index], ...data };
      if (Number(merged.hargaJual) < Number(merged.hargaModal)) {
        throw apiError("Harga jual tidak boleh lebih kecil dari harga modal.", "PRICE_BELOW_COST");
      }
      products[index] = merged;
      tulis(KEY.products, products);
      return merged;
    },

    deactivateProduct: async (id) => {
      const products = getProducts();
      const index = products.findIndex((p) => p.id === id);
      if (index < 0) throw apiError("Produk tidak ditemukan.", "NOT_FOUND");
      products[index].aktif = false;
      tulis(KEY.products, products);
      return { id, aktif: false };
    },

    /**
     * Meniru validasi server: harga dibaca dari "database" lokal (bukan dari
     * argumen), stok dicek lebih dulu, baru dikurangi.
     */
    createTransaction: async ({ items, paymentMethod, cashReceived, discount = 0, qrisReference = null, cardReference = null }) => {
      const products = getProducts();
      const lines = [];
      const kurang = [];

      for (const item of items ?? []) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) throw apiError(`Produk tidak ditemukan (${item.productId}).`, "NOT_FOUND");

        const tersedia = stokTersedia(product);
        if (tersedia < item.qty) {
          kurang.push({ name: product.name, diminta: item.qty, tersedia });
          continue;
        }
        lines.push({
          productId: product.id,
          name: product.name,
          sku: product.sku,
          hargaJual: Number(product.hargaJual) || 0,
          hargaModal: Number(product.hargaModal) || 0,
          qty: item.qty
        });
      }

      if (kurang.length > 0) {
        const ringkas = kurang.map((k) => `${k.name} (minta ${k.diminta}, sisa ${k.tersedia})`).join("; ");
        throw apiError(`Stok tidak mencukupi: ${ringkas}.`, "INSUFFICIENT_STOCK", { kurang });
      }
      if (lines.length === 0) throw apiError("Keranjang tidak boleh kosong.", "EMPTY_CART");

      const totals = computeTotals(lines, { discount });

      let change = null;
      if (paymentMethod === "cash") {
        const result = computeChange(cashReceived, totals.total);
        if (!result.sufficient) {
          throw apiError("Uang yang diterima kurang dari total tagihan.", "INSUFFICIENT_CASH");
        }
        change = result.change;
      }

      for (const line of lines) {
        const product = products.find((p) => p.id === line.productId);
        product.stok = Math.max(0, (Number(product.stok) || 0) - line.qty);
      }
      tulis(KEY.products, products);

      const trx = {
        id: idBaru(),
        receiptNumber: `TRX-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(Date.now()).slice(-4)}`,
        cashierUid: "demo-user",
        cashierName: "Nabila (Demo)",
        paymentMethod,
        cashReceived: paymentMethod === "cash" ? cashReceived : null,
        change,
        qrisReference: paymentMethod === "qris" ? qrisReference : null,
        cardReference: paymentMethod === "card" ? cardReference : null,
        ...totals,
        itemCount: lines.reduce((sum, l) => sum + l.qty, 0),
        lines,
        createdAt: new Date().toISOString()
      };
      tulis(KEY.trx, [trx, ...getTrx()].slice(0, 500));
      return trx;
    },

    listTransactions: async ({ from, to, limit = 100 } = {}) => getTrx()
      .filter((t) => (!from || t.createdAt >= from) && (!to || t.createdAt <= to))
      .slice(0, limit),

    createExpense: async (data) => {
      if (data.type === "restock") return restock(data);
      const expense = {
        id: idBaru(),
        type: data.type,
        amount: Number(data.amount) || 0,
        note: data.note ?? "",
        productId: null,
        createdAt: new Date().toISOString()
      };
      tulis(KEY.exp, [expense, ...getExp()]);
      return expense;
    },

    restock,

    listExpenses: async ({ from, to, limit = 100 } = {}) => getExp()
      .filter((e) => (!from || e.createdAt >= from) && (!to || e.createdAt <= to))
      .slice(0, limit),

    /**
     * Agregasi yang mengikuti aturan yang sama dengan report.service.js.
     * Kalau logika di server berubah, modul ini harus ikut disesuaikan —
     * itulah sebabnya keduanya diuji dengan ekspektasi angka yang sama.
     */
    getReport: async ({ period = "week", from, to } = {}) => {
      const now = new Date();
      const start = from ? new Date(from) : new Date(now);
      const end = to ? new Date(to) : new Date(now);

      if (!from) {
        start.setHours(0, 0, 0, 0);
        const mundur = period === "month" ? 29 : period === "today" ? 0 : 6;
        start.setDate(start.getDate() - mundur);
      }
      end.setHours(23, 59, 59, 999);

      const trx = getTrx().filter((t) => {
        const d = new Date(t.createdAt);
        return d >= start && d <= end;
      });
      const exp = getExp().filter((e) => {
        const d = new Date(e.createdAt);
        return d >= start && d <= end;
      });

      let pemasukan = 0;
      let labaKotor = 0;
      let totalItemTerjual = 0;
      const perMetodeBayar = {};
      const perProduk = new Map();
      const perHari = new Map();

      for (const t of trx) {
        const total = Number(t.total) || 0;
        pemasukan += total;

        const metode = t.paymentMethod || "lainnya";
        perMetodeBayar[metode] ??= { jumlah: 0, total: 0 };
        perMetodeBayar[metode].jumlah += 1;
        perMetodeBayar[metode].total += total;

        const kunci = new Date(t.createdAt).toISOString().slice(0, 10);
        perHari.set(kunci, (perHari.get(kunci) || 0) + total);

        for (const line of t.lines ?? []) {
          const qty = Number(line.qty) || 0;
          const laba = lineProfit(line);
          totalItemTerjual += qty;
          labaKotor += laba;

          const agg = perProduk.get(line.productId)
            ?? { productId: line.productId, name: line.name, qty: 0, omzet: 0, laba: 0 };
          agg.qty += qty;
          agg.omzet += (Number(line.hargaJual) || 0) * qty;
          agg.laba += laba;
          perProduk.set(line.productId, agg);
        }
      }

      const pengeluaran = exp.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

      // Periode sebelumnya dengan panjang sama, untuk badge tren.
      const durasi = end.getTime() - start.getTime();
      const laluMulai = new Date(start.getTime() - durasi - 1);
      const laluSelesai = new Date(start.getTime() - 1);

      let laluPemasukan = 0;
      let laluLaba = 0;
      let laluItem = 0;
      let laluTrx = 0;
      for (const t of getTrx()) {
        const d = new Date(t.createdAt);
        if (d < laluMulai || d > laluSelesai) continue;
        laluTrx += 1;
        laluPemasukan += Number(t.total) || 0;
        for (const line of t.lines ?? []) {
          laluItem += Number(line.qty) || 0;
          laluLaba += lineProfit(line);
        }
      }
      const laluPengeluaran = getExp()
        .filter((e) => {
          const d = new Date(e.createdAt);
          return d >= laluMulai && d <= laluSelesai;
        })
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

      const grafikHarian = [];
      for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const kunci = d.toISOString().slice(0, 10);
        grafikHarian.push({ label: NAMA_HARI[d.getDay()], tanggal: kunci, total: perHari.get(kunci) || 0 });
      }

      return {
        range: { from: start.toISOString(), to: end.toISOString() },
        perbandingan: {
          pemasukan: bandingkan(pemasukan, laluPemasukan),
          pengeluaran: bandingkan(pengeluaran, laluPengeluaran),
          labaKotor: bandingkan(labaKotor, laluLaba),
          jumlahTransaksi: bandingkan(trx.length, laluTrx),
          totalItemTerjual: bandingkan(totalItemTerjual, laluItem)
        },
        pemasukan,
        pengeluaran,
        labaKotor,
        labaBersih: labaKotor - pengeluaran,
        jumlahTransaksi: trx.length,
        rataRataTransaksi: trx.length ? Math.round(pemasukan / trx.length) : 0,
        totalItemTerjual,
        perMetodeBayar,
        produkTerjual: [...perProduk.values()].sort((a, b) => b.qty - a.qty),
        grafikHarian: grafikHarian.slice(-31)
      };
    }
  };
}
