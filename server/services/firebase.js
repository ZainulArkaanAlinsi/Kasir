/**
 * Inisialisasi Firebase Admin. Dipisah agar service lain cukup mengimpor
 * `getDb()` tanpa tahu bagaimana kredensial disiapkan (SoC).
 */
import admin from "firebase-admin";

let initialized = false;

/**
 * Inisialisasi sekali saja (idempoten).
 * Mendukung emulator: bila FIRESTORE_EMULATOR_HOST diset, kredensial asli
 * tidak diperlukan sehingga test bisa jalan tanpa service account.
 * @returns {boolean} true bila Admin SDK siap dipakai
 */
/**
 * Kredensial dari variabel lingkungan, bila ada.
 *
 * applicationDefault() menuntut sebuah BERKAS di disk. Itu cocok di laptop
 * dan di Cloud Run, tetapi tidak di hosting serverless seperti Vercel yang
 * tidak menyediakan tempat menaruh berkas rahasia — di sana kredensial hanya
 * bisa dititipkan lewat variabel lingkungan.
 *
 * Nilainya boleh JSON apa adanya atau hasil base64, karena sebagian panel
 * hosting merusak baris baru di dalam private_key saat ditempel mentah.
 *
 * @returns {object|null} objek service account, atau null bila tidak diset
 */
function kredensialDariEnv() {
  const mentah = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!mentah) return null;

  const teks = mentah.startsWith("{")
    ? mentah
    : Buffer.from(mentah, "base64").toString("utf8");

  const akun = JSON.parse(teks);
  // Panel hosting kerap menyimpan "\n" sebagai dua karakter, bukan baris baru.
  if (typeof akun.private_key === "string") {
    akun.private_key = akun.private_key.replace(/\\n/g, "\n");
  }
  return akun;
}

export function initFirebase() {
  if (initialized) return true;
  if (admin.apps.length) { initialized = true; return true; }

  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  try {
    if (usingEmulator) {
      admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "kasirone-dev" });
    } else {
      const akun = kredensialDariEnv();
      admin.initializeApp(akun
        ? { credential: admin.credential.cert(akun), projectId: akun.project_id }
        : { credential: admin.credential.applicationDefault() });
    }
    initialized = true;
    return true;
  } catch (error) {
    // Sengaja tidak melempar: server tetap boleh menyajikan frontend & mode demo
    // walaupun kredensial Firebase belum disiapkan. Sebabnya dicatat tanpa isi
    // kredensial, supaya kunci privat tidak pernah ikut ke log.
    console.warn("[firebase] Admin SDK tidak aktif:", error?.message ?? "sebab tidak diketahui");
    return false;
  }
}

/** @returns {boolean} apakah Admin SDK siap */
export const isFirebaseReady = () => initialized || admin.apps.length > 0;

/** @returns {FirebaseFirestore.Firestore} */
export const getDb = () => admin.firestore();

/** @returns {import("firebase-admin").auth.Auth} */
export const getAuth = () => admin.auth();

export { admin };
