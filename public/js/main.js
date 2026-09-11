/**
 * Titik masuk aplikasi.
 *
 * Tugasnya hanya merakit: memasang event, menghubungkan perubahan state ke
 * fungsi render, dan mengatur navigasi halaman. Tidak ada logika bisnis
 * di sini — itu milik lapisan API dan service di server.
 */
import { subscribe, set, get } from "./state.js";
import { $, $$, closeAllModals, closeModal } from "./ui/shell.js";
import { bindAuth, setOnReady } from "./auth.js";
import { renderCart, clearCart, addToCart } from "./ui/cart.js";
import { refreshProducts, renderProductGrid, bindProductForm, bukaFormProduk } from "./ui/products.js";
import { bindPaymentMethods, openPayment, confirmPayment } from "./ui/checkout.js";
import { refreshDashboard } from "./ui/dashboard.js";
import { refreshReport } from "./ui/reports.js";
import { refreshTransactions, bindTransactionFilters } from "./ui/transactions.js";
import { refreshExpenses, bindExpenseForms, bukaRestock, isiPilihanProduk } from "./ui/restock.js";
import { attachBarcodeListener, handleScan } from "./ui/barcode.js";
import { kameraDidukung, mulaiPindai, hentikanPindai } from "./ui/camera-scan.js";
import { getApi } from "./api/index.js";
import { refreshSettings, bindSettings } from "./ui/settings.js";
import { eksporTransaksi, eksporLaporan } from "./ui/export-csv.js";
import { refreshOrders, bindOrders } from "./ui/orders.js";

/** Judul dan keterangan tiap halaman. */
const HALAMAN = {
  dashboard: { title: "Dashboard", eyebrow: "Ringkasan" },
  kasir: { title: "Kasir", eyebrow: "Transaksi" },
  produk: { title: "Produk", eyebrow: "Inventori" },
  restock: { title: "Restock & Pengeluaran", eyebrow: "Modal" },
  pesanan: { title: "Pesanan Online", eyebrow: "Etalase" },
  transaksi: { title: "Riwayat Transaksi", eyebrow: "Histori" },
  laporan: { title: "Laporan", eyebrow: "Analitik" },
  pengaturan: { title: "Pengaturan", eyebrow: "Sistem" }
};

/**
 * Berpindah halaman dan memuat datanya.
 * @param {string} nama
 */
async function setPage(nama) {
  if (!HALAMAN[nama]) return;
  set("activePage", nama);

  $$(".page").forEach((p) => p.classList.remove("active-page"));
  $(`${nama}Page`)?.classList.add("active-page");
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.page === nama));
  $$(".rail-btn, .tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.page === nama));
  $("sideNav")?.classList.remove("open");   // tutup menu geser di layar sempit
  window.scrollTo({ top: 0, behavior: "smooth" });

  if ($("pageTitle")) $("pageTitle").textContent = HALAMAN[nama].title;
  if ($("pageEyebrow")) $("pageEyebrow").textContent = HALAMAN[nama].eyebrow;

  // Memuat data hanya untuk halaman yang dibuka (hemat kuota Firestore).
  if (nama === "dashboard") await refreshDashboard();
  if (nama === "laporan") await refreshReport();
  if (nama === "transaksi") await refreshTransactions();
  if (nama === "restock") { isiPilihanProduk(); await refreshExpenses(); }
  if (nama === "pesanan") await refreshOrders();
  if (nama === "pengaturan") await refreshSettings();
}

/** Dijalankan sekali setelah pengguna berhasil masuk. */
async function mulaiSesi() {
  bindSettings();
  await refreshProducts();
  await setPage("dashboard");
  await refreshSettings();   // agar label mode benar sejak awal
  await refreshOrders();     // agar jumlah pesanan menunggu tampil di menu
  renderCart();
}

function bindNavigasi() {
  $$(".nav-item, .rail-btn, .tab-btn").forEach((btn) => btn.addEventListener("click", () => setPage(btn.dataset.page)));
  $("navToggle")?.addEventListener("click", () => $("sideNav")?.classList.toggle("open"));
  $$("[data-go]").forEach((btn) => btn.addEventListener("click", () => setPage(btn.dataset.go)));
  $$("[data-close]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.close)));

  $("topNewSale")?.addEventListener("click", () => setPage("kasir"));
  $("newTransaction")?.addEventListener("click", () => { closeModal("successModal"); setPage("kasir"); });
  $("printReceipt")?.addEventListener("click", () => window.print());
  $("addProductBtn")?.addEventListener("click", bukaFormProduk);

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAllModals(); });
}

function bindKasir() {
  $("productSearch")?.addEventListener("input", renderProductGrid);
  $("cartDiscount")?.addEventListener("input", (e) => {
    set("cartDiscount", Math.max(0, Number(e.target.value) || 0));
    renderCart();
  });
  $("clearCart")?.addEventListener("click", () => {
    clearCart();
    set("cartDiscount", 0);
    if ($("cartDiscount")) $("cartDiscount").value = "0";
  });
  $("checkoutBtn")?.addEventListener("click", openPayment);

  // Di layar sempit keranjang adalah lembar geser, jadi butuh pemicu.
  // Di layar lebar CSS membuatnya selalu tampak dan kelas ini tidak berpengaruh.
  $("bukaKeranjangKasir")?.addEventListener("click", () => $("cartPanel")?.classList.add("open"));
  $("tutupKeranjangKasir")?.addEventListener("click", () => $("cartPanel")?.classList.remove("open"));
  $("confirmPayment")?.addEventListener("click", (e) => confirmPayment(e.currentTarget));

  // Scanner USB: dengarkan ketikan cepat di mana pun selama halaman Kasir.
  attachBarcodeListener((kode) => {
    if (get("activePage") !== "kasir") setPage("kasir");
    handleScan(kode, getApi(), addToCart);
  });

  bindKamera();
}

/**
 * Pindai lewat kamera, sebagai cadangan bagi toko yang belum punya scanner USB.
 * Tombolnya hanya dimunculkan bila peramban benar-benar mendukung — memunculkan
 * tombol yang selalu menolak saat ditekan lebih membingungkan daripada tidak
 * ada tombol sama sekali.
 */
function bindKamera() {
  const tombol = $("tombolKamera");
  if (!tombol || !kameraDidukung()) return;

  tombol.classList.remove("hidden");

  const tutup = () => {
    hentikanPindai();
    closeModal("modalKamera");
  };

  tombol.addEventListener("click", async () => {
    openModal("modalKamera");
    const status = $("statusKamera");
    if (status) status.textContent = "Menyalakan kamera…";

    try {
      await mulaiPindai($("videoKamera"), (kode) => {
        tutup();
        handleScan(kode, getApi(), addToCart);
      });
      if (status) status.textContent = "Arahkan barcode ke dalam bingkai.";
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  });

  $("tutupKamera")?.addEventListener("click", tutup);
  // Kamera WAJIB dimatikan saat modal ditutup lewat jalur mana pun,
  // kalau tidak lampunya tetap menyala dan baterai terkuras diam-diam.
  document.querySelector('[data-close="modalKamera"]')?.addEventListener("click", tutup);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("modalKamera")?.classList.contains("hidden")) tutup();
  });
}

function bindLaporan() {
  $("reportPeriod")?.addEventListener("change", refreshReport);
  $("chartPeriod")?.addEventListener("change", refreshDashboard);
  $("reportExportBtn")?.addEventListener("click", () => eksporLaporan(get("report")));
  $("trxExportBtn")?.addEventListener("click", () => eksporTransaksi(get("transactions")));
}

function bindRestockShortcut() {
  // Tombol "Restock" di tabel produk dibuat ulang setiap render,
  // jadi dipasang lewat event delegation di elemen induk yang tetap ada.
  $("productTable")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-restock]");
    if (btn) bukaRestock(btn.dataset.restock);
  });
}

// --- Perubahan state memicu render, sehingga modul tidak saling memanggil ---
subscribe("cart", renderCart);
subscribe("products", () => {
  if (get("activePage") === "kasir") renderProductGrid();
});

// Setelah transaksi selesai, segarkan data yang terpengaruh.
document.addEventListener("kasirone:transaksi-selesai", async () => {
  await refreshProducts();
  if (get("activePage") === "dashboard") await refreshDashboard();
});

// Membatalkan atau menyelesaikan pesanan mengubah stok, jadi katalog ikut
// disegarkan agar kasir tidak melihat angka yang sudah basi.
document.addEventListener("kasirone:stok-berubah", async () => {
  await refreshProducts();
});

bindNavigasi();
bindKasir();
bindLaporan();
bindRestockShortcut();
bindProductForm();
bindExpenseForms();
bindTransactionFilters();
bindPaymentMethods();
bindOrders();
setOnReady(mulaiSesi);
bindAuth();
