/**
 * Keranjang belanja.
 *
 * Keranjang menyimpan SNAPSHOT harga saat barang dimasukkan, tapi angka
 * yang mengikat tetap dihitung ulang oleh server saat checkout. Jadi kalau
 * admin mengubah harga di tengah transaksi, kasir akan melihat penolakan
 * yang jelas, bukan diam-diam menagih angka lama.
 */
import { computeTotals } from "../shared/money.js";
import { stokTersedia } from "../shared/product.js";
import { get, set } from "../state.js";
import { $, showToast } from "./shell.js";
import { money, escapeHtml } from "../format.js";
import { tileBg, initials } from "./tile.js";

/**
 * Menambahkan produk ke keranjang, menghormati batas stok.
 * @param {object} product
 * @param {number} [qty]
 * @returns {boolean} true bila berhasil
 */
export function addToCart(product, qty = 1) {
  if (!product?.id) return false;

  const cart = [...get("cart")];
  // Batas keranjang mengikuti stok TERSEDIA, bukan stok fisik: sebagian
  // barang bisa sedang dikunci untuk pesanan online yang belum diambil.
  const stok = stokTersedia(product);
  const existing = cart.find((item) => item.productId === product.id);
  const qtyBaru = (existing?.qty ?? 0) + qty;

  if (qtyBaru > stok) {
    showToast(`Stok "${product.name}" tinggal ${stok}.`, "error");
    return false;
  }

  if (existing) {
    existing.qty = qtyBaru;
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      hargaJual: Number(product.hargaJual) || 0,
      hargaModal: Number(product.hargaModal) || 0,
      stok,
      // Dipakai hanya untuk menggambar ubin baris keranjang; tidak pernah
      // ikut dikirim ke server saat checkout.
      category: product.category ?? "",
      imageUrl: product.imageUrl ?? null,
      qty
    });
  }

  set("cart", cart);
  return true;
}

/**
 * Menambah/mengurangi jumlah satu baris keranjang.
 * @param {string} productId
 * @param {number} delta
 */
export function changeQty(productId, delta) {
  const cart = [...get("cart")];
  const item = cart.find((i) => i.productId === productId);
  if (!item) return;

  const qtyBaru = item.qty + delta;
  if (qtyBaru <= 0) {
    set("cart", cart.filter((i) => i.productId !== productId));
    return;
  }
  if (qtyBaru > item.stok) {
    showToast(`Stok "${item.name}" tinggal ${item.stok}.`, "error");
    return;
  }
  item.qty = qtyBaru;
  set("cart", cart);
}

/** Mengosongkan keranjang. */
export const clearCart = () => set("cart", []);

/**
 * Angka-angka keranjang saat ini.
 * @returns {{subtotal:number, discount:number, tax:number, total:number}}
 */
export function cartTotals() {
  const diskon = Math.max(0, Number(get("cartDiscount")) || 0);
  return computeTotals(get("cart"), { discount: diskon });
}

/**
 * Payload yang dikirim ke API. Sengaja HANYA productId dan qty —
 * harga tidak pernah ikut dikirim, karena server wajib membacanya sendiri.
 * @returns {Array<{productId:string, qty:number}>}
 */
export const cartItemsForApi = () => get("cart").map(({ productId, qty }) => ({ productId, qty }));

/** Menggambar ulang panel keranjang. */
export function renderCart() {
  const cart = get("cart");
  const jumlahItem = cart.reduce((sum, i) => sum + i.qty, 0);

  const cartCount = $("cartCount");
  if (cartCount) cartCount.textContent = `${jumlahItem} item`;
  const navCount = $("navCartCount");
  if (navCount) navCount.textContent = String(jumlahItem);

  const container = $("cartItems");
  if (container) {
    container.innerHTML = cart.length
      ? cart.map((item, i) => {
        const ubin = item.imageUrl
          ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy">`
          : escapeHtml(initials(item.name));

        return `
        <div class="cart-item" style="animation-delay:${Math.min(i, 8) * 0.03}s">
          <span class="cart-tile" style="background:${tileBg(item.category)}">${ubin}</span>
          <div class="cart-item-body">
            <strong>${escapeHtml(item.name)}</strong>
            <small>${money(item.hargaJual)} · ${money(item.hargaJual * item.qty)}</small>
          </div>
          <div class="qty-row">
            <button class="qty-btn" data-minus="${escapeHtml(item.productId)}" aria-label="Kurangi ${escapeHtml(item.name)}">&minus;</button>
            <span>${item.qty}</span>
            <button class="qty-btn" data-plus="${escapeHtml(item.productId)}" aria-label="Tambah ${escapeHtml(item.name)}">+</button>
          </div>
        </div>`;
      }).join("")
      : `<div class="empty-cart">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><use href="#i-cart"/></svg>
          <div>Scan barcode atau klik produk.<br>Stok dicek langsung dari server.</div>
        </div>`;

    container.querySelectorAll("[data-minus]").forEach((b) => {
      b.onclick = () => changeQty(b.dataset.minus, -1);
    });
    container.querySelectorAll("[data-plus]").forEach((b) => {
      b.onclick = () => changeQty(b.dataset.plus, 1);
    });
  }

  const totals = cartTotals();
  if ($("subtotal")) $("subtotal").textContent = money(totals.subtotal);
  if ($("tax")) $("tax").textContent = money(totals.tax);
  if ($("grandTotal")) $("grandTotal").textContent = money(totals.total);
  if ($("checkoutBtn")) $("checkoutBtn").disabled = cart.length === 0;

  renderCartFab(jumlahItem, totals.total);
}

/**
 * Bilah keranjang mengambang di layar sempit.
 *
 * Di ponsel panel keranjang tertutup secara default, jadi tanpa bilah ini
 * kasir kehilangan jejak berapa total yang sedang berjalan — dan harus
 * membuka panel hanya untuk mengeceknya.
 *
 * @param {number} jumlahItem
 * @param {number} total
 */
function renderCartFab(jumlahItem, total) {
  const fab = $("cartFab");
  if (!fab) return;

  // Hanya relevan di halaman Kasir; di halaman lain ia cuma menutupi isi.
  const tampil = jumlahItem > 0 && get("activePage") === "kasir";
  fab.classList.toggle("hidden", !tampil);
  if (!tampil) return;

  const hitung = $("fabCount");
  const nilai = $("fabTotal");
  if (hitung) hitung.textContent = `${jumlahItem} item di keranjang`;
  if (nilai) nilai.textContent = money(total);
}
