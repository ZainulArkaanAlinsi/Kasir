/**
 * Middleware autentikasi & otorisasi.
 *
 * Role dibaca dari custom claim pada ID token lebih dulu (M0). Kalau claim
 * belum ada — misalnya akun lama yang dibuat sebelum fitur ini — kita jatuh
 * balik membaca dokumen users/{uid}. Tanpa fallback ini, semua kasir yang
 * sudah terdaftar akan langsung terkunci begitu fitur claim dinyalakan.
 */
import { getAuth, getDb, isFirebaseReady } from "../services/firebase.js";
import { forbidden, unauthorized, AppError } from "../lib/errors.js";

export const ROLES = Object.freeze({
  ADMIN: "admin",
  CASHIER: "cashier",
  /**
   * Pembeli di etalase online (M9). Sengaja dipisah dari staf toko: pelanggan
   * tidak boleh menyentuh produk, laporan, apalagi harga modal. Satu-satunya
   * data yang boleh ia lihat adalah pesanannya sendiri.
   */
  CUSTOMER: "customer"
});

/** Peran yang bekerja di dalam toko. */
export const PERAN_STAF = [ROLES.ADMIN, ROLES.CASHIER];

/**
 * Pintu masuk khusus staf toko.
 *
 * Dibuat sebagai konstanta tersendiri karena begitu peran pelanggan ada,
 * setiap rute yang sebelumnya cukup "sudah login" berubah arti: pelanggan
 * juga sudah login. Rute kasir, riwayat transaksi, dan laporan harus
 * menyatakan stafnya secara eksplisit.
 */
export const hanyaStaf = () => requireRole(...PERAN_STAF);

/** Memastikan request membawa ID token Firebase yang sah. */
export async function verifyFirebaseToken(req, _res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) throw unauthorized();
    if (!isFirebaseReady()) {
      throw new AppError(503, "Firebase Admin belum dikonfigurasi di server.", "FIREBASE_UNAVAILABLE");
    }

    const decoded = await getAuth().verifyIdToken(header.slice(7));
    req.user = decoded;
    next();
  } catch (error) {
    next(error instanceof AppError ? error : unauthorized("Token tidak valid atau sudah kedaluwarsa."));
  }
}

/**
 * Melampirkan role ke req.userRole.
 * @returns {import("express").RequestHandler}
 */
export async function attachRole(req, _res, next) {
  try {
    let role = req.user?.role; // custom claim
    if (!role) {
      const snap = await getDb().collection("users").doc(req.user.uid).get();
      if (!snap.exists) throw forbidden("Profil pengguna belum dibuat.");
      role = snap.data().role;
      req.userProfile = snap.data();
    }
    if (!Object.values(ROLES).includes(role)) throw forbidden("Role tidak dikenal.");
    req.userRole = role;
    next();
  } catch (error) {
    next(error instanceof AppError ? error : forbidden());
  }
}

/**
 * Membatasi akses ke role tertentu.
 * @param {...string} allowed
 * @returns {import("express").RequestHandler}
 */
export function requireRole(...allowed) {
  return (req, _res, next) => {
    if (!allowed.includes(req.userRole)) {
      return next(forbidden(`Aksi ini hanya untuk: ${allowed.join(", ")}.`));
    }
    next();
  };
}

/**
 * Identitas kasir untuk disimpan di dokumen transaksi.
 * @param {import("express").Request} req
 * @returns {{uid:string, name:string, email:string|null}}
 */
export function cashierFrom(req) {
  return {
    uid: req.user.uid,
    name: req.user.name || req.userProfile?.displayName || req.user.email || "Kasir",
    email: req.user.email ?? null
  };
}
