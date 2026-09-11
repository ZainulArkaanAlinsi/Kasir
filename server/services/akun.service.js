/**
 * Pengelolaan akun staf lewat Admin SDK.
 *
 * Dipisah dari scripts/ karena dua skrip berbeda membutuhkan langkah yang
 * sama persis (buat akun lalu tetapkan peran). Menyalin logikanya ke dua
 * berkas berarti suatu hari nanti satu disesuaikan dan satunya tertinggal —
 * tepat jenis keretakan yang sudah pernah terjadi di proyek ini pada
 * perhitungan total keranjang.
 */
import { getAuth, getDb, admin } from "./firebase.js";

/** Peran yang boleh diberikan lewat skrip administrasi. */
export const PERAN_SAH = Object.freeze(["admin", "cashier"]);

/**
 * Memastikan sebuah akun ada. Bila email sudah terdaftar, akun yang ada
 * dipakai apa adanya — kata sandi TIDAK ditimpa, supaya menjalankan ulang
 * skrip tidak diam-diam mengunci pemilik akun di luar.
 *
 * @param {{email: string, password: string, displayName?: string}} input
 * @returns {Promise<{user: import("firebase-admin").auth.UserRecord, baru: boolean}>}
 */
export async function pastikanAkun({ email, password, displayName }) {
  try {
    return { user: await getAuth().getUserByEmail(email), baru: false };
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }

  const user = await getAuth().createUser({
    email,
    password,
    displayName: displayName || email.split("@")[0],
    emailVerified: true
  });
  return { user, baru: true };
}

/**
 * Menetapkan peran di DUA tempat, dan keduanya memang disengaja:
 *  - custom claim pada ID token  -> dibaca Security Rules & middleware tanpa
 *    perlu membaca dokumen tambahan (lebih cepat dan lebih murah)
 *  - dokumen users/{uid}          -> agar peran tetap terlihat di UI admin
 *    dan tersedia sebagai cadangan untuk akun lama
 *
 * @param {import("firebase-admin").auth.UserRecord} user
 * @param {string} role
 * @param {string} [displayName]
 * @returns {Promise<string>} nama yang akhirnya tersimpan
 */
export async function tetapkanPeran(user, role, displayName) {
  if (!PERAN_SAH.includes(role)) {
    throw new Error(`Peran harus salah satu dari: ${PERAN_SAH.join(", ")}.`);
  }

  const nama = displayName || user.displayName || (user.email ?? "").split("@")[0];

  await getAuth().setCustomUserClaims(user.uid, { role });
  await getDb().collection("users").doc(user.uid).set({
    email: user.email ?? null,
    displayName: nama,
    role,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return nama;
}
