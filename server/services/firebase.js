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
export function initFirebase() {
  if (initialized) return true;
  if (admin.apps.length) { initialized = true; return true; }

  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  try {
    admin.initializeApp(
      usingEmulator
        ? { projectId: process.env.GCLOUD_PROJECT || "kasirone-dev" }
        : { credential: admin.credential.applicationDefault() }
    );
    initialized = true;
    return true;
  } catch {
    // Sengaja tidak melempar: server tetap boleh menyajikan frontend & mode demo
    // walaupun kredensial Firebase belum disiapkan.
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
