/**
 * Layanan pembayaran QRIS.
 *
 * Ada tiga tingkat kepercayaan, dan aplikasi HARUS jujur menyatakan yang mana
 * sedang aktif. Menampilkan QR palsu seolah-olah pembayaran sungguhan adalah
 * cara tercepat kehilangan uang toko.
 *
 *   1. "gateway"  - MIDTRANS_SERVER_KEY diisi. QRIS dinamis dibuat lewat
 *                   Midtrans, nominalnya terkunci, status dicek ke server
 *                   Midtrans. Ini satu-satunya mode yang boleh dianggap
 *                   sebagai verifikasi pembayaran sungguhan.
 *   2. "statis"   - MERCHANT_QRIS_PAYLOAD diisi dengan QRIS statis milik toko.
 *                   QR-nya asli dan uang benar-benar masuk ke rekening toko,
 *                   TETAPI nominal tidak terkunci dan sistem tidak bisa tahu
 *                   sudah dibayar atau belum. Kasir wajib mengecek mutasi.
 *   3. "nonaktif" - Tidak ada yang dikonfigurasi. QRIS ditolak, bukan dipalsukan.
 */
import crypto from "node:crypto";
import QRCode from "qrcode";
import { AppError, badRequest } from "../lib/errors.js";
import { requireNumber, requireString } from "../lib/validate.js";

const MIDTRANS_KEY = process.env.MIDTRANS_SERVER_KEY || "";
const MIDTRANS_PRODUKSI = process.env.MIDTRANS_IS_PRODUCTION === "true";
const QRIS_STATIS = process.env.MERCHANT_QRIS_PAYLOAD || "";

const BASIS_URL = MIDTRANS_PRODUKSI
  ? "https://api.midtrans.com"
  : "https://api.sandbox.midtrans.com";

/**
 * Mode pembayaran QRIS yang sedang aktif.
 * @returns {"gateway"|"statis"|"nonaktif"}
 */
export function modeQris() {
  if (MIDTRANS_KEY) return "gateway";
  if (QRIS_STATIS) return "statis";
  return "nonaktif";
}

/**
 * Ringkasan status untuk ditampilkan di halaman Pengaturan.
 * @returns {{mode:string, terverifikasi:boolean, lingkungan:string, keterangan:string}}
 */
export function statusPembayaran() {
  const mode = modeQris();
  return {
    mode,
    // Hanya mode gateway yang benar-benar memverifikasi pembayaran.
    terverifikasi: mode === "gateway",
    lingkungan: mode === "gateway" ? (MIDTRANS_PRODUKSI ? "produksi" : "sandbox") : "-",
    keterangan: {
      gateway: MIDTRANS_PRODUKSI
        ? "QRIS dinamis aktif. Nominal terkunci dan status pembayaran diverifikasi ke Midtrans."
        : "QRIS dinamis aktif dalam mode SANDBOX. Uang tidak benar-benar berpindah — jangan dipakai melayani pembeli.",
      statis: "Memakai QRIS statis toko. Uang masuk ke rekening toko, tetapi nominal tidak terkunci dan sistem tidak dapat memastikan pembayaran. Kasir wajib mengecek mutasi sebelum menyerahkan barang.",
      nonaktif: "Belum dikonfigurasi. Pembayaran QRIS dinonaktifkan agar tidak ada QR palsu yang tampil sebagai pembayaran sungguhan."
    }[mode]
  };
}

/** Mengubah teks payload QRIS menjadi gambar QR data URL. */
async function gambarQr(payload) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512,
    color: { dark: "#000000", light: "#ffffff" }
  });
}

/**
 * Membuat permintaan pembayaran QRIS.
 *
 * @param {{amount:number, orderId:string}} input
 * @returns {Promise<{mode:string, orderId:string, qrImage:string, terverifikasi:boolean, keterangan:string, expiresAt:string|null}>}
 * @throws {AppError} 503 bila QRIS belum dikonfigurasi
 */
export async function buatPembayaranQris({ amount, orderId }) {
  const nominal = requireNumber(amount, "Nominal", { min: 1, integer: true });
  const order = requireString(orderId, "Order ID", { max: 60 });
  const mode = modeQris();

  if (mode === "nonaktif") {
    throw new AppError(
      503,
      "Pembayaran QRIS belum dikonfigurasi di server. Gunakan Tunai atau Kartu, atau isi MIDTRANS_SERVER_KEY / MERCHANT_QRIS_PAYLOAD pada .env.",
      "QRIS_NOT_CONFIGURED"
    );
  }

  if (mode === "statis") {
    return {
      mode,
      orderId: order,
      qrImage: await gambarQr(QRIS_STATIS),
      terverifikasi: false,
      keterangan: "QRIS statis: nominal tidak terkunci. Cek mutasi sebelum menyerahkan barang.",
      expiresAt: null
    };
  }

  // Mode gateway: QRIS dinamis lewat Midtrans Core API.
  const auth = Buffer.from(`${MIDTRANS_KEY}:`).toString("base64");
  let respons;
  try {
    respons = await fetch(`${BASIS_URL}/v2/charge`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`
      },
      body: JSON.stringify({
        payment_type: "qris",
        transaction_details: { order_id: order, gross_amount: nominal },
        qris: { acquirer: "gopay" }
      }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new AppError(502, "Tidak bisa menghubungi layanan pembayaran. Periksa koneksi internet.", "GATEWAY_UNREACHABLE");
  }

  const data = await respons.json().catch(() => ({}));
  if (!respons.ok || !["201", "200"].includes(String(data.status_code))) {
    // Pesan dari gateway diteruskan apa adanya hanya bila berupa teks pendek,
    // supaya detail internal mereka tidak bocor mentah ke kasir.
    const pesan = Array.isArray(data.status_message) ? data.status_message.join(", ") : data.status_message;
    throw new AppError(502, `Gateway menolak permintaan: ${String(pesan || "tidak diketahui").slice(0, 160)}`, "GATEWAY_REJECTED");
  }

  const qrString = data.actions?.find((a) => a.name === "generate-qr-code")?.url;
  if (!qrString) throw new AppError(502, "Gateway tidak mengembalikan kode QR.", "GATEWAY_NO_QR");

  return {
    mode,
    orderId: order,
    // Midtrans memberi URL gambar QR, bukan payload mentah; dipakai langsung.
    qrImage: qrString,
    terverifikasi: true,
    keterangan: MIDTRANS_PRODUKSI
      ? "Tunjukkan QR ini ke pembeli. Status akan terverifikasi otomatis."
      : "MODE SANDBOX — uang tidak benar-benar berpindah.",
    expiresAt: data.expiry_time ?? null
  };
}

/**
 * Memeriksa status pembayaran ke gateway.
 *
 * @param {string} orderId
 * @returns {Promise<{status:"lunas"|"menunggu"|"gagal"|"tidak-diketahui", raw:string}>}
 * @throws {AppError}
 */
export async function cekStatusQris(orderId) {
  const order = requireString(orderId, "Order ID", { max: 60 });
  if (modeQris() !== "gateway") {
    throw badRequest("Status otomatis hanya tersedia bila payment gateway aktif.", "NO_GATEWAY");
  }

  const auth = Buffer.from(`${MIDTRANS_KEY}:`).toString("base64");
  let respons;
  try {
    respons = await fetch(`${BASIS_URL}/v2/${encodeURIComponent(order)}/status`, {
      headers: { Accept: "application/json", Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    throw new AppError(502, "Tidak bisa memeriksa status pembayaran.", "GATEWAY_UNREACHABLE");
  }

  const data = await respons.json().catch(() => ({}));
  const s = data.transaction_status;

  const status = s === "settlement" || s === "capture" ? "lunas"
    : s === "pending" ? "menunggu"
    : ["deny", "cancel", "expire", "failure"].includes(s) ? "gagal"
    : "tidak-diketahui";

  return { status, raw: String(s ?? "-") };
}


/**
 * Memverifikasi keaslian pemberitahuan pembayaran dari Midtrans (M12).
 *
 * Ini satu-satunya endpoint yang boleh diakses tanpa login, karena yang
 * memanggilnya adalah server Midtrans, bukan pengguna. Justru karena itu
 * verifikasinya wajib: tanpa memeriksa tanda tangan, siapa pun yang tahu
 * alamat webhook bisa mengirim "pesanan ini sudah lunas" dan mengambil
 * barang tanpa membayar.
 *
 * Midtrans menandatangani dengan:
 *   sha512(order_id + status_code + gross_amount + server_key)
 *
 * @param {object} payload badan permintaan dari Midtrans
 * @returns {boolean} true bila tanda tangan cocok
 */
export function verifikasiTandaTanganWebhook(payload) {
  if (!MIDTRANS_KEY) return false;

  const { order_id: orderId, status_code: statusCode, gross_amount: gross, signature_key: tandaTangan } = payload ?? {};
  if (!orderId || !statusCode || !gross || !tandaTangan) return false;

  const harusnya = crypto
    .createHash("sha512")
    .update(`${orderId}${statusCode}${gross}${MIDTRANS_KEY}`)
    .digest("hex");

  // Perbandingan waktu-tetap. Perbandingan biasa membocorkan berapa banyak
  // karakter awal yang sudah benar lewat selisih waktu eksekusi, sehingga
  // tanda tangan bisa ditebak sepotong demi sepotong.
  const a = Buffer.from(harusnya, "utf8");
  const b = Buffer.from(String(tandaTangan), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Menerjemahkan status Midtrans menjadi keputusan yang dipahami sistem.
 *
 * @param {object} payload
 * @returns {{status:"lunas"|"menunggu"|"gagal"|"tidak-diketahui", orderId:string|null, raw:string}}
 */
export function bacaStatusWebhook(payload) {
  const s = payload?.transaction_status;
  const penipuan = payload?.fraud_status;

  // "capture" pada kartu kredit belum tentu aman: Midtrans bisa menandainya
  // sebagai tertunda untuk ditinjau manual. Hanya "accept" yang boleh
  // dianggap lunas.
  const lunas = s === "settlement" || (s === "capture" && penipuan === "accept");

  const status = lunas ? "lunas"
    : s === "pending" ? "menunggu"
    : ["deny", "cancel", "expire", "failure"].includes(s) ? "gagal"
    : "tidak-diketahui";

  return { status, orderId: payload?.order_id ?? null, raw: String(s ?? "-") };
}
