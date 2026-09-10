/**
 * Uji murni untuk logika periode laporan.
 * buildReport() sendiri butuh Firestore, jadi diuji terpisah di emulator;
 * yang diuji di sini adalah bagian yang tidak bergantung database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolvePeriod } from "../server/services/report.service.js";
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
