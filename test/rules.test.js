/**
 * Uji Firestore Security Rules.
 *
 * Yang dibuktikan di sini bukan "kelihatannya benar", tapi bahwa browser
 * BENAR-BENAR tidak bisa menyentuh data uang & stok. Semua penulisan wajib
 * lewat backend yang memakai Admin SDK.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc } from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "kasirone-rules-test",
  firestore: { rules: fs.readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 }
});

/** Konteks kasir & admin memakai custom claim role. */
const kasir = testEnv.authenticatedContext("kasir-1", { role: "cashier" }).firestore();
const admin = testEnv.authenticatedContext("admin-1", { role: "admin" }).firestore();
const tamu = testEnv.unauthenticatedContext().firestore();
const pembeli = testEnv.authenticatedContext("pembeli-1", { role: "customer" }).firestore();
const pembeliLain = testEnv.authenticatedContext("pembeli-2", { role: "customer" }).firestore();

test.before(async () => {
  // Data awal ditulis dengan rules dimatikan, meniru penulisan oleh server.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/kasir-1"), { role: "cashier", displayName: "Nabila" });
    await setDoc(doc(db, "users/admin-1"), { role: "admin", displayName: "Admin Toko" });
    await setDoc(doc(db, "products/p1"), { name: "Indomie", hargaJual: 3500, hargaModal: 2800, stok: 10 });
    await setDoc(doc(db, "transactions/t1"), { total: 20535, cashierUid: "kasir-1" });
    await setDoc(doc(db, "expenses/e1"), { type: "restock", amount: 50000 });
    await setDoc(doc(db, "auditLogs/a1"), { action: "CREATE_TRANSACTION" });
    await setDoc(doc(db, "orders/o1"), { customerUid: "pembeli-1", status: "menunggu_bayar", total: 25000 });
    await setDoc(doc(db, "orders/o2"), { customerUid: "pembeli-2", status: "dibayar", total: 40000 });
  });
});

test.after(async () => { await testEnv.cleanup(); });

test("tamu tanpa login tidak bisa membaca apa pun", async () => {
  await assertFails(getDoc(doc(tamu, "products/p1")));
  await assertFails(getDoc(doc(tamu, "transactions/t1")));
});

test("kasir boleh MEMBACA produk (untuk grid kasir)", async () => {
  await assertSucceeds(getDoc(doc(kasir, "products/p1")));
});

test("kasir TIDAK BISA mengubah stok produk langsung", async () => {
  await assertFails(updateDoc(doc(kasir, "products/p1"), { stok: 9999 }));
});

test("kasir TIDAK BISA mengubah harga produk langsung", async () => {
  await assertFails(updateDoc(doc(kasir, "products/p1"), { hargaJual: 1 }));
});

test("admin pun TIDAK BISA menulis produk dari browser (harus lewat server)", async () => {
  await assertFails(updateDoc(doc(admin, "products/p1"), { hargaJual: 1 }));
  await assertFails(setDoc(doc(admin, "products/p2"), { name: "Palsu" }));
});

test("kasir TIDAK BISA membuat transaksi langsung ke Firestore", async () => {
  await assertFails(addDoc(collection(kasir, "transactions"), { total: 1 }));
});

test("kasir boleh membaca riwayat transaksi", async () => {
  await assertSucceeds(getDoc(doc(kasir, "transactions/t1")));
});

test("kasir TIDAK BISA melihat pengeluaran/modal toko", async () => {
  await assertFails(getDoc(doc(kasir, "expenses/e1")));
});

test("admin boleh melihat pengeluaran", async () => {
  await assertSucceeds(getDoc(doc(admin, "expenses/e1")));
});

test("PRIVILEGE ESCALATION: kasir tidak bisa menaikkan role dirinya jadi admin", async () => {
  await assertFails(updateDoc(doc(kasir, "users/kasir-1"), { role: "admin" }));
});

test("kasir masih boleh mengganti nama tampilannya sendiri", async () => {
  await assertSucceeds(updateDoc(doc(kasir, "users/kasir-1"), { displayName: "Nabila S." }));
});

test("kasir tidak bisa membaca profil kasir lain", async () => {
  await assertFails(getDoc(doc(kasir, "users/admin-1")));
});

test("audit log tidak bisa dihapus atau diubah siapa pun", async () => {
  await assertFails(deleteDoc(doc(admin, "auditLogs/a1")));
  await assertFails(updateDoc(doc(admin, "auditLogs/a1"), { action: "diedit" }));
  await assertFails(addDoc(collection(kasir, "auditLogs"), { action: "palsu" }));
});

test("koleksi acak di luar skema ditolak", async () => {
  await assertFails(setDoc(doc(admin, "rahasia/x"), { a: 1 }));
});

test("pelanggan boleh membaca pesanannya sendiri", async () => {
  await assertSucceeds(getDoc(doc(pembeli, "orders/o1")));
});

test("PRIVASI: pelanggan TIDAK BISA membaca pesanan pelanggan lain", async () => {
  await assertFails(getDoc(doc(pembeli, "orders/o2")));
  await assertFails(getDoc(doc(pembeliLain, "orders/o1")));
});

test("pelanggan TIDAK BISA membuat atau mengubah pesanan langsung", async () => {
  await assertFails(addDoc(collection(pembeli, "orders"), { customerUid: "pembeli-1", total: 1 }));
  await assertFails(updateDoc(doc(pembeli, "orders/o1"), { status: "dibayar" }));
  await assertFails(updateDoc(doc(pembeli, "orders/o1"), { total: 1 }));
});

test("staf toko boleh membaca semua pesanan", async () => {
  await assertSucceeds(getDoc(doc(admin, "orders/o1")));
  await assertSucceeds(getDoc(doc(kasir, "orders/o2")));
});

test("pelanggan TIDAK BISA melihat produk lewat SDK (harga modal ikut di sana)", async () => {
  await assertFails(getDoc(doc(pembeli, "products/p1")));
});

test("pelanggan TIDAK BISA melihat transaksi kasir, pengeluaran, atau audit", async () => {
  await assertFails(getDoc(doc(pembeli, "transactions/t1")));
  await assertFails(getDoc(doc(pembeli, "expenses/e1")));
  await assertFails(getDoc(doc(pembeli, "auditLogs/a1")));
});

test("pendaftaran sebagai customer diizinkan, sebagai admin ditolak", async () => {
  const baru = testEnv.authenticatedContext("pembeli-baru").firestore();
  await assertSucceeds(setDoc(doc(baru, "users/pembeli-baru"), { role: "customer", displayName: "Baru" }));

  const nakal = testEnv.authenticatedContext("nakal").firestore();
  await assertFails(setDoc(doc(nakal, "users/nakal"), { role: "admin", displayName: "Nakal" }));
});

/**
 * Repositori ini publik, jadi apiKey di public/firebase-config.js bisa dibaca
 * siapa saja, dan pendaftaran Email/Password terbuka. Artinya orang asing
 * SELALU bisa memperoleh token yang sah tanpa peran apa pun.
 *
 * Yang menahannya cuma satu baris rules. Kalau 'cashier' ikut boleh ditulis
 * sendiri, orang asing itu tinggal menulis profilnya sebagai kasir — roleOf()
 * jatuh balik ke dokumen users/{uid} karena tokennya tidak punya claim — lalu
 * harga modal dan seluruh riwayat transaksi toko terbuka untuknya.
 */
test("KENAIKAN HAK: orang asing tidak bisa mendaftarkan dirinya sebagai kasir", async () => {
  const asing = testEnv.authenticatedContext("orang-asing").firestore();
  await assertFails(setDoc(doc(asing, "users/orang-asing"), { role: "cashier", displayName: "Asing" }));
});

test("KENAIKAN HAK: mendaftar sebagai customer tidak membuka data toko", async () => {
  const asing = testEnv.authenticatedContext("asing-2").firestore();
  await assertSucceeds(setDoc(doc(asing, "users/asing-2"), { role: "customer", displayName: "Asing" }));

  await assertFails(getDoc(doc(asing, "products/p1")));
  await assertFails(getDoc(doc(asing, "transactions/t1")));
  await assertFails(getDoc(doc(asing, "expenses/e1")));
});
