#!/usr/bin/env node
/**
 * Mengganti sandi satu akun staf.
 *
 * Sandi TIDAK diambil dari argumen perintah, dan itu disengaja. Argumen
 * tersimpan di riwayat terminal, terbaca di daftar proses selama perintah
 * berjalan, dan ikut terbawa kalau perintahnya sempat ditempel ke mana-mana.
 * Di sini sandi diketik saat diminta, tanpa ditampilkan di layar, lalu
 * langsung dikirim ke Firebase.
 *
 * Cara ini sekaligus menyelesaikan masalah yang lebih membosankan: Command
 * Prompt memperlakukan &, ^, |, dan % sebagai perintah, sehingga sandi yang
 * mengandung karakter itu rusak sebelum sampai ke Firebase — persis kegagalan
 * yang membuat orang mengira sandinya sudah berganti padahal belum.
 *
 * Pemakaian:
 *   node scripts/ganti-sandi.js [email]
 */
import "dotenv/config";
import readline from "node:readline";
import { initFirebase, getAuth } from "../server/services/firebase.js";

const EMAIL_BAWAAN = process.env.ADMIN_EMAIL || "zainaril13@gmail.com";
const email = process.argv[2] || EMAIL_BAWAAN;

/**
 * Meminta teks biasa yang boleh terlihat, misalnya jawaban ya/tidak.
 * @param {string} tanya
 * @returns {Promise<string>}
 */
function tanyaTeks(tanya) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((selesai) => rl.question(tanya, (jawab) => { rl.close(); selesai(jawab.trim()); }));
}

/**
 * Meminta sandi tanpa menampilkannya di layar.
 *
 * Ketikan sengaja tidak digemakan sama sekali — bukan diganti bintang —
 * supaya panjang sandi pun tidak terbaca orang yang kebetulan melihat layar.
 *
 * @param {string} tanya
 * @returns {Promise<string>}
 */
function tanyaSandi(tanya) {
  return new Promise((selesai, gagal) => {
    const stdin = process.stdin;
    const bisaSenyap = typeof stdin.setRawMode === "function";

    if (!bisaSenyap) {
      // Terminal tidak mendukung mode mentah (misalnya dijalankan dari dalam
      // editor). Lebih jujur memberi tahu daripada diam-diam menampilkannya.
      process.stdout.write("  (perhatian: terminal ini akan menampilkan ketikanmu)\n");
    }
    process.stdout.write(tanya);

    let isi = "";
    stdin.setEncoding("utf8");
    if (bisaSenyap) stdin.setRawMode(true);
    stdin.resume();

    const selesaikan = (dibatalkan) => {
      if (bisaSenyap) stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", padaKetik);
      process.stdout.write("\n");
      if (dibatalkan) gagal(new Error("Dibatalkan."));
      else selesai(isi);
    };

    function padaKetik(potongan) {
      for (const ch of potongan) {
        if (ch === "\r" || ch === "\n") return selesaikan(false);
        if (ch === "") return selesaikan(true);            // Ctrl+C
        if (ch === "" || ch === "\b") { isi = isi.slice(0, -1); continue; }
        if (ch >= " ") isi += ch;
      }
    }

    stdin.on("data", padaKetik);
  });
}

async function main() {
  if (!initFirebase()) {
    console.error("\n  [X] Firebase Admin gagal dimuat.");
    console.error("      Periksa .env dan serviceAccountKey.json di folder project.\n");
    process.exit(1);
  }

  let pengguna;
  try {
    pengguna = await getAuth().getUserByEmail(email);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      console.error(`\n  [X] Tidak ada akun dengan email ${email}.`);
      console.error('      Buat dulu: node scripts/buat-akun.js <email> <sandi> admin "Nama"\n');
    } else {
      console.error("\n  [X] Gagal mencari akun:", e.message, "\n");
    }
    process.exit(1);
  }

  console.log("\n  ============================================================");
  console.log("   Ganti sandi");
  console.log("  ============================================================");
  console.log(`   Akun   : ${pengguna.email}`);
  console.log(`   Status : ${pengguna.disabled ? "DINONAKTIFKAN" : "aktif"}`);
  console.log("\n   Ketikanmu tidak akan terlihat di layar. Itu normal —");
  console.log("   ketik saja sampai selesai lalu tekan Enter.\n");

  const sandi = await tanyaSandi("   Sandi baru   : ");
  if (sandi.length < 6) {
    console.error("\n  [X] Firebase menolak sandi di bawah 6 karakter. Tidak ada yang diubah.\n");
    process.exit(1);
  }

  const ulang = await tanyaSandi("   Ketik ulang  : ");
  if (sandi !== ulang) {
    console.error("\n  [X] Dua ketikan tidak sama. Tidak ada yang diubah.\n");
    process.exit(1);
  }

  // Sandi yang gampang ditebak disebut apa adanya, tetapi tidak dilarang:
  // yang memakai aplikasi ini yang menanggung akibatnya, jadi dia yang berhak
  // memutuskan — asalkan memutuskannya sambil tahu.
  const LEMAH = ["admin321", "admin123", "123456", "password", "qwerty", "kasir123"];
  if (LEMAH.includes(sandi.toLowerCase())) {
    console.log("\n   Catatan: sandi ini ada di daftar tebakan pertama alat pembobol,");
    console.log("   sedangkan aplikasimu sudah bisa dibuka siapa saja di internet.");
    const lanjut = await tanyaTeks("   Tetap pakai? (y/t): ");
    if (lanjut.toLowerCase() !== "y") {
      console.log("\n   Dibatalkan. Tidak ada yang diubah.\n");
      process.exit(0);
    }
  }

  try {
    await getAuth().updateUser(pengguna.uid, { password: sandi });
  } catch (e) {
    if (e.code === "auth/configuration-not-found") {
      console.error("\n  [X] Metode login Email/Password belum aktif di Firebase.");
      console.error("      Firebase Console > Build > Authentication > Sign-in method,");
      console.error("      nyalakan Email/Password, lalu ulangi.\n");
    } else {
      console.error("\n  [X] Gagal mengganti sandi:", e.message, "\n");
    }
    process.exit(1);
  }

  console.log("\n  ============================================================");
  console.log("   [OK] Sandi berhasil diganti.");
  console.log("\n   Login di https://kasirone.vercel.app");
  console.log(`   Email : ${pengguna.email}`);
  console.log("   Sandi : yang barusan kamu ketik");
  console.log("  ============================================================\n");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("\n  [X]", e?.message ?? e, "\n");
  process.exit(1);
});
