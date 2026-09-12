/**
 * Alur pembayaran.
 *
 * Dua prinsip yang menentukan seluruh isi berkas ini:
 *
 * 1. Tombol "Konfirmasi" TIDAK menghitung apa pun yang mengikat. Ia mengirim
 *    daftar productId + qty; server yang menentukan total, kembalian, dan
 *    apakah stok mencukupi. Angka di layar hanya pratinjau.
 *
 * 2. Aplikasi tidak boleh berpura-pura sudah menerima uang. Bila payment
 *    gateway aktif, transaksi hanya boleh disimpan setelah gateway menyatakan
 *    lunas. Bila tidak aktif, kasir diberi tahu gamblang bahwa verifikasi
 *    dilakukan manual — bukan disodori QR yang terlihat sah tapi tidak menagih.
 */
import { get, set } from "../state.js";
import { $, $$, openModal, closeModal, showToast, showApiError, withBusy } from "./shell.js";
import { money, escapeHtml, labelMetode, tanggal } from "../format.js";
import { computeChange } from "../shared/money.js";
import { cartTotals, cartItemsForApi, clearCart } from "./cart.js";
import { getApi } from "../api/index.js";
import { bukaLayarPembeli, perbaruiStatus, tutupLayarPembeli, bindLayarPembeli, setOnPembayaranDiterima } from "./customer-screen.js";

/** Status pembayaran QRIS untuk transaksi yang sedang berjalan. */
let qris = { orderId: null, mode: null, terverifikasi: false, lunas: false, qrImage: null, keterangan: "" };

/** Pewaktu polling status; wajib dihentikan saat modal ditutup. */
let pollTimer = null;

/** Menghentikan polling dan membersihkan state QRIS. */
function resetQris() {
  clearInterval(pollTimer);
  pollTimer = null;
  qris = { orderId: null, mode: null, terverifikasi: false, lunas: false, qrImage: null, keterangan: "" };
  tutupLayarPembeli();
  const frame = $("qrFrame");
  if (frame) frame.innerHTML = "";
}

/** Memasang tombol pemilih metode pembayaran. */
export function bindPaymentMethods() {
  $$(".payment-method").forEach((btn) => {
    btn.addEventListener("click", async () => {
      $$(".payment-method").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const metode = btn.dataset.method;
      set("paymentMethod", metode);
      $("cashArea")?.classList.toggle("hidden", metode !== "cash");
      $("qrisArea")?.classList.toggle("hidden", metode !== "qris");
      $("cardArea")?.classList.toggle("hidden", metode !== "card");

      hitungKembalian();
      if (metode === "qris") await siapkanQris();
      else resetQris();
    });
  });

  $("cashReceived")?.addEventListener("input", hitungKembalian);
  bindPecahanCepat();
  $$('[data-close="paymentModal"]').forEach((b) => b.addEventListener("click", resetQris));

  bindLayarPembeli();
  // Saat pembeli selesai membayar, kasir kembali ke layarnya sendiri untuk
  // menyimpan transaksi. Penyimpanan tetap satu jalur, tidak digandakan.
  setOnPembayaranDiterima(() => {
    qris.lunas = true;
    confirmPayment($("confirmPayment"));
  });

  $("bukaLayarPembeli")?.addEventListener("click", () => {
    if (!qris.orderId) {
      showToast("Siapkan QRIS lebih dulu.", "error");
      return;
    }
    bukaLayarPembeli({
      qrImage: qris.qrImage,
      orderId: qris.orderId,
      keterangan: qris.keterangan,
      terverifikasi: qris.terverifikasi
    });
  });
}

/** Membuka modal pembayaran dengan total terkini. */
export function openPayment() {
  if (get("cart").length === 0) {
    showToast("Keranjang masih kosong.", "error");
    return;
  }
  resetQris();

  if ($("paymentTotal")) $("paymentTotal").textContent = money(cartTotals().total);
  if ($("cashReceived")) $("cashReceived").value = "";
  hitungKembalian();
  openModal("paymentModal");
}

/**
 * Pecahan cepat: "Pas" mengisi tepat sebesar total, sisanya lembaran yang
 * paling sering diserahkan pembeli. Mengetik "100000" berkali-kali sehari
 * adalah pekerjaan yang tidak perlu ada.
 */
function bindPecahanCepat() {
  const container = $("quickCash");
  const input = $("cashReceived");
  if (!container || !input) return;

  container.querySelectorAll("[data-cash]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nilai = btn.dataset.cash;
      input.value = String(nilai === "pas" ? cartTotals().total : Number(nilai) || 0);
      hitungKembalian();
    });
  });
}

/**
 * Pratinjau kembalian saat kasir mengetik uang yang diterima.
 *
 * Bila uangnya masih kurang, kotaknya berubah merah dan menyebut
 * kekurangannya — jauh lebih berguna daripada menampilkan "Rp0" yang
 * terbaca seolah transaksi sudah pas.
 */
function hitungKembalian() {
  const el = $("changeAmount");
  if (!el) return;

  const diterima = Number($("cashReceived")?.value || 0);
  const total = cartTotals().total;
  const kurang = diterima > 0 && diterima < total;

  el.textContent = kurang
    ? `Kurang ${money(total - diterima)}`
    : money(computeChange(diterima, total).change);

  $("changeBox")?.classList.toggle("kurang", kurang);
}

/** Menampilkan baris status di area QRIS. */
function tulisStatusQris(html, kelas = "qr-wait") {
  const el = $("qrisStatus");
  if (!el) return;
  el.className = kelas;
  el.innerHTML = html;
}

/**
 * Meminta kode QR ke server dan menampilkannya.
 * Semua kemungkinan hasil ditampilkan apa adanya — termasuk saat QRIS belum
 * dikonfigurasi, supaya tidak ada QR palsu yang terlihat sah.
 */
async function siapkanQris() {
  const frame = $("qrFrame");
  const hint = $("qrisHint");
  const orderId = `KSR-${Date.now()}`;

  tulisStatusQris('<span class="spinner"></span> Menyiapkan kode QR…');
  if (frame) frame.innerHTML = "";

  try {
    const hasil = await getApi().createQris({ amount: cartTotals().total, orderId });
    qris = { orderId, mode: hasil.mode, terverifikasi: hasil.terverifikasi, lunas: false, qrImage: hasil.qrImage ?? null, keterangan: hasil.keterangan ?? "" };

    if (frame) {
      frame.innerHTML = hasil.qrImage
        ? `<img src="${escapeHtml(hasil.qrImage)}" alt="Kode QR pembayaran">`
        : `<div style="color:#111;font-size:12px;font-weight:700;text-align:center;padding:14px">
             Tidak ada kode QR<br><span style="font-weight:400">pada mode ini</span>
           </div>`;
    }
    if (hint) hint.textContent = hasil.keterangan ?? "";

    if (hasil.terverifikasi) {
      tulisStatusQris('<span class="spinner"></span> Menunggu pembayaran…');
      mulaiPolling(orderId);
    } else {
      tulisStatusQris("Verifikasi manual — cek mutasi sebelum menyerahkan barang.");
    }
  } catch (error) {
    if (frame) frame.innerHTML = "";
    if (hint) hint.textContent = "";
    tulisStatusQris(escapeHtml(error.message || "Gagal menyiapkan QRIS."), "qr-wait danger-text");
    qris = { orderId: null, mode: "gagal", terverifikasi: false, lunas: false, qrImage: null, keterangan: "" };
  }
}

/** Memeriksa status pembayaran berkala sampai lunas atau modal ditutup. */
function mulaiPolling(orderId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    // Modal sudah ditutup atau order berganti: hentikan.
    if ($("paymentModal")?.classList.contains("hidden") || qris.orderId !== orderId) {
      resetQris();
      return;
    }
    try {
      const { status } = await getApi().qrisStatus(orderId);
      if (status === "lunas") {
        qris.lunas = true;
        clearInterval(pollTimer);
        tulisStatusQris("Pembayaran diterima. Silakan konfirmasi.", "qr-wait positive");
        perbaruiStatus("lunas");
        showToast("Pembayaran QRIS diterima.", "success");
      } else if (status === "gagal") {
        clearInterval(pollTimer);
        tulisStatusQris("Pembayaran gagal atau kedaluwarsa.", "qr-wait danger-text");
        perbaruiStatus("gagal");
      }
    } catch {
      // Kegagalan sesaat saat polling tidak perlu mengganggu kasir;
      // percobaan berikutnya akan mencoba lagi.
    }
  }, 3000);
}

/**
 * Mengirim transaksi ke server.
 * @param {HTMLButtonElement} [tombol] tombol pemicu, dinonaktifkan selama proses
 */
export async function confirmPayment(tombol) {
  if (get("cart").length === 0) return;

  const paymentMethod = get("paymentMethod");
  const total = cartTotals().total;

  if (paymentMethod === "cash") {
    const diterima = Number($("cashReceived")?.value || 0);
    if (!computeChange(diterima, total).sufficient) {
      showToast("Uang yang diterima belum cukup.", "error");
      return;
    }
  }

  if (paymentMethod === "qris") {
    if (qris.mode === "gagal" || !qris.orderId) {
      showToast("QRIS belum siap. Pilih metode lain atau coba lagi.", "error");
      return;
    }
    // Bila gateway aktif, kita PUNYA cara memastikan pembayaran — maka
    // transaksi tidak boleh disimpan sebelum benar-benar lunas.
    if (qris.terverifikasi && !qris.lunas) {
      showToast("Pembayaran belum diterima gateway. Tunggu sampai statusnya lunas.", "error");
      return;
    }
  }

  const payload = {
    items: cartItemsForApi(),
    paymentMethod,
    discount: Math.max(0, Number(get("cartDiscount")) || 0),
    cashReceived: paymentMethod === "cash" ? Number($("cashReceived")?.value || 0) : undefined,
    qrisReference: paymentMethod === "qris" ? (qris.orderId || $("qrisReference")?.value.trim() || null) : null,
    cardReference: paymentMethod === "card" ? ($("cardReference")?.value.trim() || null) : null
  };

  await withBusy(tombol, async () => {
    try {
      const trx = await getApi().createTransaction(payload);
      set("lastTransaction", trx);

      clearCart();
      set("cartDiscount", 0);
      if ($("cartDiscount")) $("cartDiscount").value = "0";

      resetQris();
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
  const namaToko = $("storeName")?.value?.trim() || "KasirOne Store";

  if ($("successText")) {
    $("successText").textContent = `${nomor} · ${labelMetode(trx.paymentMethod)} · ${money(trx.total)}`;
  }

  const baris = (kiri, kanan, tebal = false) => {
    const buka = tebal ? "<strong>" : "";
    const tutup = tebal ? "</strong>" : "";
    return `<div class="receipt-line"><span>${buka}${kiri}${tutup}</span><span>${buka}${kanan}${tutup}</span></div>`;
  };

  const item = (trx.lines ?? [])
    .map((l) => baris(`${escapeHtml(l.name)} &times;${l.qty}`, money(l.hargaJual * l.qty)))
    .join("");

  const tunai = trx.paymentMethod === "cash"
    ? baris("Tunai", money(trx.cashReceived)) + baris("Kembalian", money(trx.change), true)
    : "";

  const referensi = trx.qrisReference || trx.cardReference;

  if ($("receiptPreview")) {
    $("receiptPreview").innerHTML = `
      <strong>${escapeHtml(namaToko)}</strong><br>
      ${escapeHtml(nomor)}<br>
      ${escapeHtml(tanggal(trx.createdAt))}<br>
      Kasir: ${escapeHtml(trx.cashierName ?? "-")}
      <hr>
      ${item}
      <hr>
      ${baris("Subtotal", money(trx.subtotal))}
      ${baris("Diskon", money(trx.discount))}
      ${baris("Pajak", money(trx.tax))}
      ${baris("Total", money(trx.total), true)}
      ${tunai}
      <hr>
      ${baris("Pembayaran", escapeHtml(labelMetode(trx.paymentMethod)))}
      ${referensi ? baris("Referensi", escapeHtml(referensi)) : ""}
      <div style="text-align:center"><span class="cap-lunas">LUNAS</span></div>`;
  }

  openModal("successModal");
}
