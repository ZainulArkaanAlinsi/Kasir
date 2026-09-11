#!/usr/bin/env node
/**
 * Membuat akun staf pertama sekaligus memberinya peran.
 *
 * Firebase Console memang bisa membuat akun, tetapi akun yang lahir di sana
 * tidak punya custom claim apa pun — ia akan login lalu ditolak 403 oleh
 * setiap rute kasir. Skrip ini mengerjakan keduanya dalam satu langkah
 * sehingga tidak ada keadaan setengah jadi.
 *
 * Pemakaian:
 *   node scripts/buat-akun.js <email> <sandi> <admin|cashier> [nama]
 *
 * Aman dijalankan berulang: kalau emailnya sudah terdaftar, akun lama
 * dipakai apa adanya dan hanya perannya yang disegarkan. Kata sandi tidak
 * pernah ditimpa.
 */
import "dotenv/config";
import { initFirebase } from "../server/services/firebase.js";
import { pastikanAkun, tetapkanPeran, PERAN_SAH } from "../server/services/akun.service.js";

const [email, password, role, displayName] = process.argv.slice(2);

function keluarDenganPetunjuk(pesan) {
  console.error("\n  " + pesan + "\n");
  console.error("  Pemakaian: node scripts/buat-akun.js <email> <sandi> <admin|cashier> [nama]\n");
  process.exit(1);
}

if (!email || !password || !role) keluarDenganPetunjuk("Email, sandi, dan peran wajib diisi.");
if (password.length < 6) keluarDenganPetunjuk("Firebase menolak sandi di bawah 6 karakter.");
if (!PERAN_SAH.includes(role)) keluarDenganPetunjuk(`Peran harus salah satu dari: ${PERAN_SAH.join(", ")}.`);

if (!initFirebase()) {
  keluarDenganPetunjuk("Firebase Admin gagal dimuat. Pastikan GOOGLE_APPLICATION_CREDENTIALS di .env sudah benar.");
}

try {
  const { user, baru } = await pastikanAkun({ email, password, displayName });
  const nama = await tetapkanPeran(user, role, displayName);

  console.log("\n  " + (baru ? "Akun dibuat" : "Akun sudah ada, peran disegarkan") + ".");
  console.log(`  ${email} -> peran "${role}" (${nama})`);
  console.log(`  uid: ${user.uid}\n`);
  process.exit(0);
} catch (error) {
  if (error.code === "auth/configuration-not-found") {
    keluarDenganPetunjuk(
      "Firebase Authentication belum dinyalakan. Buka Firebase Console > Build > " +
      "Authentication > Get started, pilih Email/Password, aktifkan, lalu ulangi perintah ini."
    );
  }
  console.error("\n  Gagal membuat akun:", error.message, "\n");
  process.exit(1);
}
