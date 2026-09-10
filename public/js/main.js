/**
 * Titik masuk aplikasi.
 *
 * Tugasnya hanya merakit: memasang event, menghubungkan perubahan state ke
 * fungsi render, dan mengatur navigasi halaman. Tidak ada logika bisnis
 * di sini — itu milik lapisan API dan service di server.
 */
import { subscribe, set, get } from "./state.js";
import { $, $$, closeAllModals, closeModal, openModal } from "./ui/shell.js";
import { bindAuth, setOnReady } from "./auth.js";
import { renderCart, clearCart, addToCart } from "./ui/cart.js";
import { refreshProducts, renderProductGrid, bindProductForm } from "./ui/products.js";
import { bindPaymentMethods, openPayment, confirmPayment } from "./ui/checkout.js";
import { refreshDashboard } from "./ui/dashboard.js";
import { refreshReport } from "./ui/reports.js";
import { refreshTransactions, bindTransactionFilters } from "./ui/transactions.js";
import { refreshExpenses, bindExpenseForms, bukaRestock, isiPilihanProduk } from "./ui/restock.js";
import { attachBarcodeListener, handleScan } from "./ui/barcode.js";
import { getApi } from "./api/index.js";

/** Judul dan keterangan tiap halaman. */
const HALAMAN = {
  dashboard: { title: "Dashboard", eyebrow: "Ringkasan" },
  kasir: { title: "Kasir", eyebrow: "Transaksi" },
  produk: { title: "Produk", eyebrow: "Inventori" },
  restock: { title: "Restock & Pengeluaran", eyebrow: "Modal" },
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

  if ($("pageTitle")) $("pageTitle").textContent = HALAMAN[nama].title;
  if ($("pageEyebrow")) $("pageEyebrow").textContent = HALAMAN[nama].eyebrow;

  // Memuat data hanya untuk halaman yang dibuka (hemat kuota Firestore).
  if (nama === "dashboard") await refreshDashboard();
  if (nama === "laporan") await refreshReport();
  if (nama === "transaksi") await refreshTransactions();
  if (nama === "restock") { isiPilihanProduk(); await refreshExpenses(); }
}

/** Dijalankan sekali setelah pengguna berhasil masuk. */
async function mulaiSesi() {
  await refreshProducts();
  await setPage("dashboard");
  renderCart();
}

function bindNavigasi() {
  $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => setPage(btn.dataset.page)));
  $$("[data-go]").forEach((btn) => btn.addEventListener("click", () => setPage(btn.dataset.go)));
  $$("[data-close]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.close)));

  $("topNewSale")?.addEventListener("click", () => setPage("kasir"));
  $("newTransaction")?.addEventListener("click", () => { closeModal("successModal"); setPage("kasir"); });
  $("printReceipt")?.addEventListener("click", () => window.print());
  $("addProductBtn")?.addEventListener("click", () => openModal("productModal"));

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAllModals(); });
}

function bindKasir() {
  $("productSearch")?.addEventListener("input", renderProductGrid);
  $("clearCart")?.addEventListener("click", clearCart);
  $("checkoutBtn")?.addEventListener("click", openPayment);
  $("confirmPayment")?.addEventListener("click", (e) => confirmPayment(e.currentTarget));

  // Scanner USB: dengarkan ketikan cepat di mana pun selama halaman Kasir.
  attachBarcodeListener((kode) => {
    if (get("activePage") !== "kasir") setPage("kasir");
    handleScan(kode, getApi(), addToCart);
  });
}

function bindLaporan() {
  $("reportPeriod")?.addEventListener("change", refreshReport);
  $("chartPeriod")?.addEventListener("change", refreshDashboard);
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

bindNavigasi();
bindKasir();
bindLaporan();
bindRestockShortcut();
bindProductForm();
bindExpenseForms();
bindTransactionFilters();
bindPaymentMethods();
setOnReady(mulaiSesi);
bindAuth();
