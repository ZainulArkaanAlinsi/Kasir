import test from "node:test";
import assert from "node:assert/strict";
import {
  computeTotals, computeChange, lineProfit, lineSubtotal, toRupiah, DEFAULT_TAX_RATE
} from "../public/js/shared/money.js";

test("keranjang kosong menghasilkan nol, bukan NaN", () => {
  assert.deepEqual(computeTotals([]), { subtotal: 0, discount: 0, tax: 0, total: 0 });
  assert.deepEqual(computeTotals(null), { subtotal: 0, discount: 0, tax: 0, total: 0 });
});

test("total normal: 2 Indomie + 1 Chitato", () => {
  const lines = [{ hargaJual: 3500, qty: 2 }, { hargaJual: 11500, qty: 1 }];
  assert.deepEqual(computeTotals(lines), { subtotal: 18500, discount: 0, tax: 2035, total: 20535 });
});

test("diskon dipotong SEBELUM pajak", () => {
  const lines = [{ hargaJual: 18500, qty: 1 }];
  const r = computeTotals(lines, { discount: 5000 });
  assert.equal(r.subtotal, 18500);
  assert.equal(r.discount, 5000);
  assert.equal(r.tax, Math.round(13500 * DEFAULT_TAX_RATE)); // pajak atas 13500, bukan 18500
  assert.equal(r.total, 13500 + r.tax);
});

test("invarian: total selalu = subtotal - diskon + pajak", () => {
  for (const d of [0, 1, 999, 5000, 18499]) {
    const r = computeTotals([{ hargaJual: 3500, qty: 2 }, { hargaJual: 11500, qty: 1 }], { discount: d });
    assert.equal(r.total, r.subtotal - r.discount + r.tax, `gagal pada diskon ${d}`);
  }
});

test("diskon lebih besar dari subtotal tidak membuat total negatif", () => {
  const r = computeTotals([{ hargaJual: 5000, qty: 1 }], { discount: 999999 });
  assert.equal(r.discount, 5000);
  assert.equal(r.total, 0);
  assert.ok(r.total >= 0);
});

test("input kotor tidak meledak", () => {
  assert.equal(lineSubtotal({ hargaJual: "abc", qty: 2 }), 0);
  assert.equal(lineSubtotal({ hargaJual: 1000, qty: -5 }), 0);   // qty negatif diabaikan
  assert.equal(lineSubtotal({ hargaJual: -1000, qty: 5 }), 0);   // harga negatif diabaikan
  assert.equal(lineSubtotal(undefined), 0);
  assert.equal(toRupiah(NaN), 0);
  assert.equal(toRupiah(Infinity), 0);
});

test("qty pecahan dibulatkan ke rupiah utuh", () => {
  assert.equal(lineSubtotal({ hargaJual: 3333, qty: 3 }), 9999);
  assert.equal(computeTotals([{ hargaJual: 3333, qty: 3 }]).tax, Math.round(9999 * 0.11));
});

test("kembalian tunai", () => {
  assert.deepEqual(computeChange(50000, 20535), { sufficient: true, change: 29465 });
  assert.deepEqual(computeChange(20535, 20535), { sufficient: true, change: 0 });
  assert.deepEqual(computeChange(20000, 20535), { sufficient: false, change: 0 });
  assert.deepEqual(computeChange(0, 1), { sufficient: false, change: 0 });
});

test("laba kotor pakai snapshot harga, boleh negatif kalau rugi", () => {
  assert.equal(lineProfit({ hargaJual: 3500, hargaModal: 2800, qty: 10 }), 7000);
  assert.equal(lineProfit({ hargaJual: 2000, hargaModal: 2500, qty: 4 }), -2000);
  assert.equal(lineProfit({}), 0);
});

test("tarif pajak bisa ditimpa (untuk toko non-PKP)", () => {
  const r = computeTotals([{ hargaJual: 10000, qty: 1 }], { taxRate: 0 });
  assert.equal(r.tax, 0);
  assert.equal(r.total, 10000);
});
