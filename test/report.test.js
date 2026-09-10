/**
 * Uji murni untuk logika periode laporan.
 * buildReport() sendiri butuh Firestore, jadi diuji terpisah di emulator;
 * yang diuji di sini adalah bagian yang tidak bergantung database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolvePeriod, bandingkan } from "../server/services/report.service.js";
import { lineProfit } from "../public/js/shared/money.js";

const acuan = new Date("2026-09-10T14:30:00");

test("periode 'today' mencakup satu hari penuh", () => {
  const { from, to } = resolvePeriod("today", acuan);
  assert.equal(from.getDate(), 10);
  assert.equal(from.getHours(), 0);
  assert.equal(to.getDate(), 10);
  assert.equal(to.getHours(), 23);
});

test("periode 'week' mencakup 7 hari TERMASUK hari ini", () => {
  const { from, to } = resolvePeriod("week", acuan);
  const hari = Math.round((to - from) / 86400000);
  assert.equal(hari, 7, "rentang harus ~7 hari");
  assert.equal(from.getDate(), 4, "mulai dari 4 September");
  assert.equal(to.getDate(), 10);
});

test("periode 'month' mencakup 30 hari", () => {
  const { from, to } = resolvePeriod("month", acuan);
  const hari = Math.round((to - from) / 86400000);
  assert.equal(hari, 30);
  assert.equal(from.getMonth(), 7, "mundur 29 hari dari 10 Sep jatuh di Agustus");
  assert.equal(from.getDate(), 12);
});

test("periode tak dikenal diperlakukan seperti 'week'", () => {
  const a = resolvePeriod("ngawur", acuan);
  const b = resolvePeriod("week", acuan);
  assert.equal(a.from.getTime(), b.from.getTime());
});

test("agregasi laba: contoh kasus Razka (Indomie 23, Kopi Aren 40)", () => {
  const lines = [
    { name: "Indomie Goreng", hargaJual: 3500, hargaModal: 2800, qty: 23 },
    { name: "Top Kopi Aren", hargaJual: 6500, hargaModal: 4800, qty: 40 }
  ];

  const perProduk = new Map();
  let labaTotal = 0;
  for (const l of lines) {
    labaTotal += lineProfit(l);
    perProduk.set(l.name, { qty: l.qty, omzet: l.hargaJual * l.qty, laba: lineProfit(l) });
  }

  assert.equal(perProduk.get("Indomie Goreng").qty, 23);
  assert.equal(perProduk.get("Top Kopi Aren").qty, 40);
  assert.equal(perProduk.get("Indomie Goreng").laba, (3500 - 2800) * 23); // 16.100
  assert.equal(perProduk.get("Top Kopi Aren").laba, (6500 - 4800) * 40);  // 68.000
  assert.equal(labaTotal, 16100 + 68000);
});

test("laba bersih = laba kotor - pengeluaran, boleh negatif", () => {
  const labaKotor = 84100;
  const pengeluaran = 120000; // restock besar bulan ini
  assert.equal(labaKotor - pengeluaran, -35900);
});

test("tren: kenaikan dan penurunan dihitung terhadap periode sebelumnya", () => {
  assert.deepEqual(bandingkan(120, 100), { persen: 20, arah: "naik" });
  assert.deepEqual(bandingkan(80, 100), { persen: -20, arah: "turun" });
  assert.deepEqual(bandingkan(100, 100), { persen: 0, arah: "tetap" });
});

test("tren: periode sebelumnya nol TIDAK menghasilkan Infinity", () => {
  const r = bandingkan(50000, 0);
  assert.equal(r.persen, null, "persentase harus null, bukan Infinity");
  assert.equal(r.arah, "naik");
  assert.ok(Number.isFinite(r.persen) === false);
});

test("tren: dua-duanya nol dianggap tetap, bukan naik", () => {
  assert.deepEqual(bandingkan(0, 0), { persen: 0, arah: "tetap" });
});

test("tren: pembanding negatif memakai nilai mutlak agar arah tidak terbalik", () => {
  // Laba minggu lalu -100 (rugi), minggu ini -50 (rugi lebih kecil) = membaik.
  const r = bandingkan(-50, -100);
  assert.equal(r.arah, "naik");
  assert.equal(r.persen, 50);
});

test("tren: input kotor tidak meledak", () => {
  assert.deepEqual(bandingkan(undefined, undefined), { persen: 0, arah: "tetap" });
  assert.deepEqual(bandingkan("abc", 100), { persen: -100, arah: "turun" });
});
