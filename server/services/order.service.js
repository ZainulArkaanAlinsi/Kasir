/**
 * Pesanan online (M11) — siklus hidup dari "saya pesan" sampai "barang saya
 * terima".
 *
 * Transaksi kasir selesai dalam satu tarikan napas: pembeli berdiri di depan,
 * bayar, bawa barang. Pesanan online tidak. Ada jeda, dan di dalam jeda itu
 * banyak hal bisa berubah — pembeli menutup peramban, pembayarannya ditolak,
 * atau ia berubah pikiran. Karena itu pesanan punya STATUS, bukan sekadar ada
 * atau tidak ada.
 *
 *   menunggu_bayar --bayar--> dibayar --siapkan--> disiapkan
 *                                                      |
 *                                          +-----------+-----------+
 *                                          v                       v
 *                                   siap_diambil               dikirim
 *                                          +-----------+-----------+
 *                                                      v
 *                                                   selesai
 *
 *   menunggu_bayar --batal / lewat waktu--> batal | kedaluwarsa
 *
 * Stok dikunci saat pesanan dibuat, dilepas saat batal atau kedaluwarsa, dan
 * benar-benar dipotong saat pesanan selesai. Aturan penguncian hidup di
 * reservation.service.js; modul ini yang memutuskan kapan memanggilnya.
 */
import { getDb, admin } from "./firebase.js";
import { computeTotals } from "../../public/js/shared/money.js";
import { kunciStok, lepasKunci, selesaikanKunci } from "./reservation.service.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { requireCartItems, requireEnum, requireString } from "../lib/validate.js";

/** Status yang diakui sistem. */
export const STATUS = Object.freeze({
  MENUNGGU_BAYAR: "menunggu_bayar",
  DIBAYAR: "dibayar",
  DISIAPKAN: "disiapkan",
  SIAP_DIAMBIL: "siap_diambil",
  DIKIRIM: "dikirim",
  SELESAI: "selesai",
  BATAL: "batal",
  KEDALUWARSA: "kedaluwarsa"
});

/**
 * Perpindahan status yang diizinkan.
 *
 * Ditulis sebagai tabel, bukan disebar menjadi rangkaian if, supaya
 * satu-satunya tempat untuk menjawab "boleh tidak dari A ke B" ada di sini.
 * Tanpa tabel ini sangat mudah tercipta jalan pintas seperti menandai pesanan
 * selesai padahal belum pernah dibayar.
 */
const TRANSISI = Object.freeze({
  [STATUS.MENUNGGU_BAYAR]: [STATUS.DIBAYAR, STATUS.BATAL, STATUS.KEDALUWARSA],
  [STATUS.DIBAYAR]: [STATUS.DISIAPKAN, STATUS.BATAL],
  [STATUS.DISIAPKAN]: [STATUS.SIAP_DIAMBIL, STATUS.DIKIRIM, STATUS.BATAL],
  [STATUS.SIAP_DIAMBIL]: [STATUS.SELESAI, STATUS.BATAL],
  [STATUS.DIKIRIM]: [STATUS.SELESAI],
  [STATUS.SELESAI]: [],
  [STATUS.BATAL]: [],
  [STATUS.KEDALUWARSA]: []
});

/** Status yang masih menahan kunci stok. */
const MASIH_MENGUNCI = [
  STATUS.MENUNGGU_BAYAR, STATUS.DIBAYAR, STATUS.DISIAPKAN,
  STATUS.SIAP_DIAMBIL, STATUS.DIKIRIM
];

export const CARA_AMBIL = Object.freeze(["pickup", "delivery"]);

/** Batas waktu membayar. Lewat ini, stok dikembalikan ke rak. */
const MENIT_KEDALUWARSA = Number(process.env.ORDER_EXPIRY_MINUTES || 60);

/** Tarif ongkir per zona. Toko satu cabang belum butuh integrasi kurir. */
const ONGKIR = Object.freeze({
  dalam_kota: Number(process.env.ONGKIR_DALAM_KOTA || 10000),
  luar_kota: Number(process.env.ONGKIR_LUAR_KOTA || 25000)
});

/**
 * Menghitung ongkos kirim.
 * @param {string} cara "pickup" | "delivery"
 * @param {string} [zona]
 * @returns {number} rupiah
 */
export function hitungOngkir(cara, zona = "dalam_kota") {
  if (cara !== "delivery") return 0;   // ambil sendiri tidak dikenai ongkir
  return ONGKIR[zona] ?? ONGKIR.dalam_kota;
}

/**
 * Nomor pesanan yang mudah dibaca manusia.
 *
 * Ekornya diambil dari id dokumen Firestore, bukan dari empat digit acak.
 * Dengan angka acak, dua pesanan bisa memakai nomor sama pada hari yang
 * sama — peluangnya sudah sekitar 50% begitu toko melewati ~120 pesanan
 * sehari. Nomor kembar berbahaya justru karena tampak sepele: pembeli
 * menyebutkan nomornya, lalu staf membuka pesanan milik orang lain.
 *
 * @param {Date} now
 * @param {string} docId id dokumen pesanan (dijamin unik oleh Firestore)
 */
function nomorPesanan(now, docId) {
  const tanggal = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `ORD-${tanggal}-${String(docId).slice(0, 6).toUpperCase()}`;
}

/**
 * Mencari pesanan yang cocok dengan order_id dari payment gateway.
 *
 * Dulu webhook menarik 200 pesanan berstatus "menunggu bayar" lalu mencari
 * di memori. Begitu antreannya lebih panjang dari itu, pembayaran yang sah
 * diam-diam tidak terdeteksi — pembeli sudah membayar, tetapi pesanannya
 * tetap tercatat belum lunas. Tiga kemungkinan bentuk id dicoba langsung ke
 * Firestore, semuanya lewat pencarian berindeks.
 *
 * @param {string} gatewayOrderId nilai order_id dari gateway
 * @returns {Promise<object|null>} pesanan beserta id-nya, atau null
 */
export async function cariPesananPembayaran(gatewayOrderId) {
  const id = String(gatewayOrderId ?? "").trim();
  if (!id) return null;

  const db = getDb();

  // 1. order_id memang id dokumen kita.
  const langsung = await db.collection("orders").doc(id).get();
  if (langsung.exists) return { id: langsung.id, ...langsung.data() };

  // 2. atau nomor pesanan yang dipajang ke pembeli, 3. atau referensi gateway.
  for (const field of ["orderNumber", "paymentRef"]) {
    const snap = await db.collection("orders").where(field, "==", id).limit(1).get();
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  return null;
}

/**
 * Memvalidasi tujuan pengiriman.
 *
 * Alamat hanya diminta bila barang memang dikirim. Meminta alamat pada
 * pesanan ambil-sendiri adalah mengumpulkan data pribadi tanpa keperluan.
 *
 * @param {object} body
 * @returns {{cara:string, zona:string|null, alamat:string|null, catatan:string, ongkir:number}}
 */
function normalkanPengiriman(body) {
  const cara = requireEnum(body?.cara, "Cara pengambilan", CARA_AMBIL);
  const catatan = body?.catatan ? requireString(body.catatan, "Catatan", { max: 300 }) : "";

  if (cara === "pickup") {
    return { cara, zona: null, alamat: null, catatan, ongkir: 0 };
  }

  const zona = requireEnum(body?.zona ?? "dalam_kota", "Zona pengiriman", Object.keys(ONGKIR));
  return {
    cara,
    zona,
    alamat: requireString(body?.alamat, "Alamat pengiriman", { min: 10, max: 500 }),
    catatan,
    ongkir: hitungOngkir(cara, zona)
  };
}

/**
 * Membuat pesanan baru dan mengunci stoknya.
 *
 * @param {object} input
 * @param {Array<{productId:string, qty:number}>} input.items dari etalase
 * @param {object} input.pengiriman cara, zona, alamat, catatan
 * @param {{uid:string, name:string, phone:string|null}} input.pelanggan
 * @returns {Promise<object>} dokumen pesanan
 * @throws {AppError} 409 stok tidak cukup, 400 input tidak valid
 */
export async function buatPesanan({ items, pengiriman, pelanggan }) {
  requireCartItems(items);
  if (!pelanggan?.uid) throw badRequest("Data pelanggan tidak lengkap.");

  const kirim = normalkanPengiriman(pengiriman);

  // Kunci stok LEBIH DULU. Kalau langkah ini gagal, tidak ada dokumen pesanan
  // yang tertinggal menggantung tanpa barang di belakangnya.
  const lines = await kunciStok(items);

  const totals = computeTotals(lines);
  const total = totals.total + kirim.ongkir;

  const db = getDb();
  const ref = db.collection("orders").doc();
  const sekarang = new Date();
  const kedaluwarsa = new Date(sekarang.getTime() + MENIT_KEDALUWARSA * 60000);

  const doc = {
    orderNumber: nomorPesanan(sekarang, ref.id),
    status: STATUS.MENUNGGU_BAYAR,
    customerUid: pelanggan.uid,
    customerName: pelanggan.name || "Pelanggan",
    customerPhone: pelanggan.phone ?? null,
    pengiriman: kirim,
    lines,
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    ongkir: kirim.ongkir,
    total,
    paymentMethod: null,
    paymentRef: null,
    riwayatStatus: [{ status: STATUS.MENUNGGU_BAYAR, pada: sekarang.toISOString(), oleh: pelanggan.uid }],
    expiresAt: admin.firestore.Timestamp.fromDate(kedaluwarsa),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  try {
    await ref.set(doc);
  } catch (error) {
    // Dokumen gagal ditulis padahal stok sudah dikunci: kembalikan barangnya.
    // Tanpa ini, stok tersandera pesanan yang tidak pernah ada.
    await lepasKunci(items).catch(() => {});
    throw error;
  }

  return {
    id: ref.id,
    ...doc,
    expiresAt: kedaluwarsa.toISOString(),
    createdAt: sekarang.toISOString()
  };
}

/**
 * Memindahkan pesanan ke status berikutnya.
 *
 * @param {string} orderId
 * @param {string} statusBaru
 * @param {{uid:string, role:string}} aktor
 * @param {{paymentMethod?:string, paymentRef?:string}} [tambahan]
 * @returns {Promise<object>}
 * @throws {AppError} 404 tidak ada, 409 perpindahan tidak sah, 403 bukan haknya
 */
export async function ubahStatus(orderId, statusBaru, aktor, tambahan = {}) {
  const id = requireString(orderId, "Order ID", { max: 128 });
  const tujuan = requireEnum(statusBaru, "Status", Object.values(STATUS));

  const db = getDb();
  const ref = db.collection("orders").doc(id);
  const waktu = new Date().toISOString();
  const entriRiwayat = { status: tujuan, pada: waktu, oleh: aktor.uid };

  // Perpindahan status di-KLAIM lebih dulu di dalam satu Firestore
  // transaction: membaca status, memeriksa keabsahannya, dan menuliskannya
  // terjadi tanpa celah di antaranya.
  //
  // Sebelumnya pemeriksaan memakai ref.get() biasa lalu stok diubah di luar
  // transaksi. Dua panggilan yang berdekatan — admin menekan "Sudah diambil"
  // dua kali, atau pembatalan pelanggan bertabrakan dengan sapuan
  // kedaluwarsa — sama-sama membaca status lama, sama-sama lolos tabel
  // transisi, dan stok fisik terpotong DUA KALI untuk satu pesanan.
  // Dengan klaim atomik, hanya panggilan pertama yang lolos; sisanya
  // ditolak sebagai transisi tidak sah.
  const { pesanan, statusLama } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound("Pesanan tidak ditemukan.");

    const data = snap.data();

    // Pelanggan hanya boleh membatalkan pesanannya sendiri yang belum dibayar.
    if (aktor.role === "customer") {
      if (data.customerUid !== aktor.uid) throw forbidden("Ini bukan pesanan Anda.");
      if (tujuan !== STATUS.BATAL) throw forbidden("Pelanggan hanya dapat membatalkan pesanan.");
      if (data.status !== STATUS.MENUNGGU_BAYAR) {
        throw conflict("Pesanan yang sudah dibayar hanya bisa dibatalkan oleh toko.", "CANCEL_NOT_ALLOWED");
      }
    }

    const boleh = TRANSISI[data.status] ?? [];
    if (!boleh.includes(tujuan)) {
      throw conflict(
        `Pesanan berstatus "${data.status}" tidak bisa diubah menjadi "${tujuan}".`,
        "INVALID_TRANSITION",
        { dari: data.status, boleh }
      );
    }

    const patch = {
      status: tujuan,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      riwayatStatus: admin.firestore.FieldValue.arrayUnion(entriRiwayat)
    };

    if (tujuan === STATUS.DIBAYAR) {
      patch.paymentMethod = tambahan.paymentMethod ?? "qris";
      patch.paymentRef = tambahan.paymentRef ?? null;
      patch.paidAt = admin.firestore.FieldValue.serverTimestamp();
    }

    tx.update(ref, patch);
    return { pesanan: data, statusLama: data.status };
  });

  // Stok baru disentuh SETELAH klaim berhasil. Urutannya disengaja: kalau
  // stok diubah lebih dulu lalu penulisan status gagal, barang terlanjur
  // berpindah tanpa jejak. Dengan urutan ini, kegagalan langkah stok
  // meninggalkan pesanan berstatus baru yang stoknya belum disesuaikan —
  // keadaan yang terlihat di panel dan bisa diperbaiki, bukan diam-diam
  // memotong stok dua kali.
  const itemsRingkas = (pesanan.lines ?? []).map((l) => ({ productId: l.productId, qty: l.qty }));
  if (itemsRingkas.length > 0) {
    if ([STATUS.BATAL, STATUS.KEDALUWARSA].includes(tujuan) && MASIH_MENGUNCI.includes(statusLama)) {
      await lepasKunci(itemsRingkas);
    } else if (tujuan === STATUS.SELESAI) {
      await selesaikanKunci(itemsRingkas);
    }
  }

  // Nilai kembalian dibersihkan dari sentinel FieldValue: kalau ikut dikirim
  // apa adanya, klien menerima objek internal Firestore alih-alih tanggal
  // yang bisa ditampilkan.
  return {
    id,
    ...pesanan,
    status: tujuan,
    updatedAt: waktu,
    riwayatStatus: [...(pesanan.riwayatStatus ?? []), entriRiwayat],
    createdAt: pesanan.createdAt?.toDate?.()?.toISOString() ?? null,
    expiresAt: pesanan.expiresAt?.toDate?.()?.toISOString() ?? null,
    ...(tujuan === STATUS.DIBAYAR
      ? {
        paymentMethod: tambahan.paymentMethod ?? "qris",
        paymentRef: tambahan.paymentRef ?? null,
        paidAt: waktu
      }
      : {})
  };
}

/**
 * Melepas kunci pesanan yang melewati batas waktu bayar.
 * Dipanggil terjadwal atau saat admin membuka panel pesanan.
 *
 * @returns {Promise<{diproses:number}>}
 */
export async function bersihkanKedaluwarsa() {
  const db = getDb();
  const snap = await db.collection("orders")
    .where("status", "==", STATUS.MENUNGGU_BAYAR)
    .where("expiresAt", "<=", admin.firestore.Timestamp.now())
    .limit(50)
    .get();

  for (const doc of snap.docs) {
    // Satu pesanan yang gagal dibersihkan tidak boleh menghentikan sisanya.
    await ubahStatus(doc.id, STATUS.KEDALUWARSA, { uid: "sistem", role: "admin" }).catch(() => {});
  }
  return { diproses: snap.size };
}

/**
 * Daftar pesanan. Pemanggil wajib menyaring berdasarkan pelanggan bila
 * aktornya bukan staf toko.
 *
 * @param {{status?:string, customerUid?:string, limit?:number}} [filter]
 * @returns {Promise<Array<object>>}
 */
export async function daftarPesanan(filter = {}) {
  let query = getDb().collection("orders").orderBy("createdAt", "desc");
  if (filter.status) query = query.where("status", "==", filter.status);
  if (filter.customerUid) query = query.where("customerUid", "==", filter.customerUid);

  const snap = await query.limit(Math.min(filter.limit ?? 50, 200)).get();
  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null,
    expiresAt: d.data().expiresAt?.toDate?.()?.toISOString() ?? null
  }));
}

/**
 * Mengambil satu pesanan, dengan penjagaan kepemilikan.
 *
 * @param {string} orderId
 * @param {{uid:string, role:string}} aktor
 * @returns {Promise<object>}
 * @throws {AppError} 404 bila tidak ada atau bukan milik pemanggil
 */
export async function ambilPesanan(orderId, aktor) {
  const id = requireString(orderId, "Order ID", { max: 128 });
  const snap = await getDb().collection("orders").doc(id).get();
  if (!snap.exists) throw notFound("Pesanan tidak ditemukan.");

  const pesanan = snap.data();
  if (aktor.role === "customer" && pesanan.customerUid !== aktor.uid) {
    // Sengaja menjawab "tidak ditemukan", bukan "bukan milik Anda". Menjawab
    // berbeda untuk pesanan yang ada dan yang tidak ada akan membocorkan
    // keberadaan pesanan orang lain kepada siapa pun yang menebak-nebak id.
    throw notFound("Pesanan tidak ditemukan.");
  }

  return {
    id: snap.id,
    ...pesanan,
    createdAt: pesanan.createdAt?.toDate?.()?.toISOString() ?? null,
    expiresAt: pesanan.expiresAt?.toDate?.()?.toISOString() ?? null
  };
}
