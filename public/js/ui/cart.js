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
      icon: product.icon ?? "\u{1F4E6}",
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
      ? cart.map((item) => `
        <div class="cart-item">
          <div class="cart-item-top">
            <div>
              <strong>${escapeHtml(item.name)}</strong><br>
              <small>${money(item.hargaJual)} x ${item.qty}</small>
            </div>
            <b>${money(item.hargaJual * item.qty)}</b>
          </div>
          <div class="qty-row">
            <button class="qty-btn" data-minus="${escapeHtml(item.productId)}" aria-label="Kurangi">&minus;</button>
            <span>${item.qty}</span>
            <button class="qty-btn" data-plus="${escapeHtml(item.productId)}" aria-label="Tambah">+</button>
          </div>
        </div>`).join("")
      : `<div class="empty-cart">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><use href="#i-cart"/></svg>
          <div>Keranjang masih kosong.<br>Scan barcode atau pilih produk.</div>
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
}
