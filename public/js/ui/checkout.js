/**
 * Alur pembayaran (M3 + M4).
 *
 * Titik penting: tombol "Konfirmasi" TIDAK menghitung apa pun yang mengikat.
 * Ia mengirim daftar productId + qty ke server, dan server yang menentukan
 * total, kembalian, serta apakah stok mencukupi. Angka di layar hanyalah
 * pratinjau agar kasir tahu harus menagih berapa.
 */
import { get, set } from "../state.js";
import { $, $$, openModal, closeModal, showToast, showApiError, withBusy } from "./shell.js";
import { money, escapeHtml, labelMetode, tanggal } from "../format.js";
import { computeChange } from "../shared/money.js";
import { cartTotals, cartItemsForApi, clearCart } from "./cart.js";
import { getApi } from "../api/index.js";

/** Memasang tombol pemilih metode pembayaran. */
export function bindPaymentMethods() {
  $$(".payment-method").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".payment-method").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const metode = btn.dataset.method;
      set("paymentMethod", metode);
      $("cashArea")?.classList.toggle("hidden", metode !== "cash");
      $("qrisArea")?.classList.toggle("hidden", metode !== "qris");
      $("cardArea")?.classList.toggle("hidden", metode !== "card");
      hitungKembalian();
    });
  });

  $("cashReceived")?.addEventListener("input", hitungKembalian);
}

/** Membuka modal pembayaran dengan total terkini. */
export function openPayment() {
  if (get("cart").length === 0) {
    showToast("Keranjang masih kosong.", "error");
    return;
  }
  const total = cartTotals().total;
  if ($("paymentTotal")) $("paymentTotal").textContent = money(total);
  if ($("cashReceived")) $("cashReceived").value = "";
  hitungKembalian();
  openModal("paymentModal");
}

/** Pratinjau kembalian saat kasir mengetik uang yang diterima. */
function hitungKembalian() {
  const el = $("changeAmount");
  if (!el) return;
  const diterima = Number($("cashReceived")?.value || 0);
  const { change } = computeChange(diterima, cartTotals().total);
  el.textContent = money(change);
}

/**
 * Mengirim transaksi ke server.
 * @param {HTMLButtonElement} [tombol] tombol pemicu, dinonaktifkan selama proses
 */
export async function confirmPayment(tombol) {
  const cart = get("cart");
  if (cart.length === 0) return;

  const paymentMethod = get("paymentMethod");
  const total = cartTotals().total;

  // Pengecekan awal di klien hanya demi umpan balik cepat.
  if (paymentMethod === "cash") {
    const diterima = Number($("cashReceived")?.value || 0);
    if (!computeChange(diterima, total).sufficient) {
      showToast("Uang yang diterima belum cukup.", "error");
      return;
    }
  }

  const payload = {
    items: cartItemsForApi(),
    paymentMethod,
    discount: get("cartDiscount") ?? 0,
    cashReceived: paymentMethod === "cash" ? Number($("cashReceived")?.value || 0) : undefined,
    qrisReference: paymentMethod === "qris" ? ($("qrisReference")?.value.trim() || null) : null
  };

  await withBusy(tombol, async () => {
    try {
      const trx = await getApi().createTransaction(payload);
      set("lastTransaction", trx);
      clearCart();
      closeModal("paymentModal");
      tampilkanStruk(trx);
      document.dispatchEvent(new CustomEvent("kasirone:transaksi-selesai"));
    } catch (error) {
      // Stok kurang adalah kondisi bisnis yang wajar, bukan crash:
      // tampilkan penjelasan spesifik agar kasir tahu barang mana.
      showApiError(error);
    }
  });
}

/**
 * Menampilkan struk hasil transaksi.
 * @param {object} trx dokumen transaksi dari server
 */
export function tampilkanStruk(trx) {
  const nomor = trx.receiptNumber ?? trx.id;
  if ($("successText")) {
    $("successText").textContent = `${nomor} \u00B7 ${labelMetode(trx.paymentMethod)} \u00B7 ${money(trx.total)}`;
  }

  const barisItem = (trx.lines ?? []).map((l) => `
    <div style="display:flex;justify-content:space-between;gap:10px">
      <span>${escapeHtml(l.name)} &times;${l.qty}</span>
      <span>${money(l.hargaJual * l.qty)}</span>
    </div>`).join("");

  const barisKembalian = trx.paymentMethod === "cash" ? `
    <div style="display:flex;justify-content:space-between"><span>Tunai</span><span>${money(trx.cashReceived)}</span></div>
    <div style="display:flex;justify-content:space-between"><strong>Kembalian</strong><strong>${money(trx.change)}</strong></div>` : "";

  if ($("receiptPreview")) {
    $("receiptPreview").innerHTML = `
      <strong>KasirOne Store</strong><br>
      ${escapeHtml(nomor)}<br>
      ${tanggal(trx.createdAt)}<br>
      Kasir: ${escapeHtml(trx.cashierName ?? "-")}
      <hr>
      ${barisItem}
      <hr>
      <div style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${money(trx.subtotal)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Diskon</span><span>${money(trx.discount)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Pajak</span><span>${money(trx.tax)}</span></div>
      <div style="display:flex;justify-content:space-between"><strong>Total</strong><strong>${money(trx.total)}</strong></div>
      ${barisKembalian}
      <hr>
      Pembayaran: ${labelMetode(trx.paymentMethod)}
      ${trx.qrisReference ? `<br>Ref QRIS: ${escapeHtml(trx.qrisReference)}` : ""}`;
  }

  openModal("successModal");
}
