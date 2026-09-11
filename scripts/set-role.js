#!/usr/bin/env node
/**
 * Mengubah peran akun yang SUDAH ada (M0).
 *
 * Pemakaian:
 *   node scripts/set-role.js kasir@toko.com cashier "Nabila"
 *   node scripts/set-role.js bos@toko.com admin "Admin Toko"
 *
 * Untuk akun yang belum ada sama sekali, pakai scripts/buat-akun.js.
 *
 * Setelah dijalankan, pengguna harus logout-login ulang (atau menunggu token
 * menyegar) agar claim barunya ikut terbawa. Ini penyebab paling umum error
 * 403 "tiba-tiba" pada stack ini.
 */
import "dotenv/config";
import { initFirebase, getAuth } from "../server/services/firebase.js";
import { tetapkanPeran, PERAN_SAH } from "../server/services/akun.service.js";

const [email, role, displayName] = process.argv.slice(2);

function keluarDenganPetunjuk(pesan) {
  console.error(`\n  ${pesan}\n`);
  console.error("  Pemakaian: node scripts/set-role.js <email> <admin|cashier> [nama]\n");
  process.exit(1);
}

if (!email || !role) keluarDenganPetunjuk("Email dan peran wajib diisi.");
if (!PERAN_SAH.includes(role)) keluarDenganPetunjuk(`Peran harus salah satu dari: ${PERAN_SAH.join(", ")}.`);

if (!initFirebase()) {
  keluarDenganPetunjuk("Firebase Admin gagal dimuat. Pastikan GOOGLE_APPLICATION_CREDENTIALS di .env sudah benar.");
}

try {
  const user = await getAuth().getUserByEmail(email);
  const nama = await tetapkanPeran(user, role, displayName);

  console.log(`\n  Berhasil. ${email} sekarang ber-peran "${role}" (${nama}).`);
  console.log("  Minta pengguna logout lalu login lagi agar token barunya terpakai.\n");
  process.exit(0);
} catch (error) {
  if (error.code === "auth/user-not-found") {
    keluarDenganPetunjuk(`Tidak ada pengguna dengan email ${email}. Buat dulu lewat: npm run buat-akun`);
  }
  console.error("\n  Gagal menetapkan peran:", error.message, "\n");
  process.exit(1);
}
