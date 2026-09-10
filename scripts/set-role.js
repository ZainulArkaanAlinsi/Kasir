#!/usr/bin/env node
/**
 * Menetapkan role seorang pengguna (M0).
 *
 * Role disimpan di DUA tempat dan keduanya memang disengaja:
 *  - custom claim pada ID token  -> dibaca Security Rules & middleware
 *    tanpa perlu membaca dokumen tambahan (lebih cepat & lebih murah)
 *  - dokumen users/{uid}          -> agar role tetap terlihat di UI admin
 *    dan tersedia sebagai cadangan untuk akun lama
 *
 * Pemakaian:
 *   node scripts/set-role.js kasir@toko.com cashier "Nabila"
 *   node scripts/set-role.js bos@toko.com admin "Admin Toko"
 *
 * Setelah dijalankan, pengguna harus logout-login ulang (atau menunggu
 * token menyegar) agar claim barunya ikut terbawa. Ini penyebab paling
 * umum error 403 "tiba-tiba" pada stack ini.
 */
import "dotenv/config";
import { initFirebase, getAuth, getDb, admin } from "../server/services/firebase.js";

const ROLE_SAH = ["admin", "cashier"];
const [email, role, displayName] = process.argv.slice(2);

function keluarDenganPetunjuk(pesan) {
  console.error(`\n  ${pesan}\n`);
  console.error("  Pemakaian: node scripts/set-role.js <email> <admin|cashier> [nama]\n");
  process.exit(1);
}

if (!email || !role) keluarDenganPetunjuk("Email dan role wajib diisi.");
if (!ROLE_SAH.includes(role)) keluarDenganPetunjuk(`Role harus salah satu dari: ${ROLE_SAH.join(", ")}.`);

if (!initFirebase()) {
  keluarDenganPetunjuk("Firebase Admin gagal dimuat. Pastikan GOOGLE_APPLICATION_CREDENTIALS di .env sudah benar.");
}

try {
  const user = await getAuth().getUserByEmail(email);
  const nama = displayName || user.displayName || email.split("@")[0];

  await getAuth().setCustomUserClaims(user.uid, { role });

  await getDb().collection("users").doc(user.uid).set({
    email: user.email ?? null,
    displayName: nama,
    role,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`\n  Berhasil. ${email} sekarang ber-role "${role}" (${nama}).`);
  console.log("  Minta pengguna logout lalu login lagi agar token barunya terpakai.\n");
  process.exit(0);
} catch (error) {
  if (error.code === "auth/user-not-found") {
    keluarDenganPetunjuk(`Tidak ada pengguna dengan email ${email}. Buat dulu di Firebase Console > Authentication.`);
  }
  console.error("\n  Gagal menetapkan role:", error.message, "\n");
  process.exit(1);
}
