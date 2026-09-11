/**
 * Uji layanan pembayaran.
 *
 * Yang paling penting dibuktikan di sini: aplikasi TIDAK boleh mengarang
 * kode QR ketika payment gateway belum dikonfigurasi. Itulah akar keraguan
 * terhadap sistem pembayaran versi sebelumnya, yang menampilkan pola QR
 * hiasan seolah-olah menagih uang sungguhan.
 */
import test from "node:test";
import assert from "node:assert/strict";

// Pastikan tidak ada konfigurasi yang bocor dari lingkungan pengembang.
delete process.env.MIDTRANS_SERVER_KEY;
delete process.env.MERCHANT_QRIS_PAYLOAD;

const { modeQris, statusPembayaran, buatPembayaranQris, cekStatusQris } =
  await import("../server/services/payment.service.js");

test("tanpa konfigurasi, QRIS berstatus nonaktif", () => {
  assert.equal(modeQris(), "nonaktif");
  const s = statusPembayaran();
  assert.equal(s.terverifikasi, false, "tidak boleh mengaku terverifikasi");
  assert.match(s.keterangan, /Belum dikonfigurasi/i);
});

test("QRIS nonaktif MENOLAK membuat pembayaran, bukan memalsukan QR", async () => {
  await assert.rejects(
    () => buatPembayaranQris({ amount: 20535, orderId: "KSR-1" }),
    (err) => err.code === "QRIS_NOT_CONFIGURED" && err.status === 503
  );
});

test("cek status ditolak bila gateway tidak aktif", async () => {
  await assert.rejects(
    () => cekStatusQris("KSR-1"),
    (err) => err.code === "NO_GATEWAY"
  );
});

test("nominal tidak valid ditolak sebelum menyentuh jaringan", async () => {
  process.env.MERCHANT_QRIS_PAYLOAD = "00020101021126...ID.CO.QRIS.WWW";
  const mod = await import(`../server/services/payment.service.js?v=${Date.now()}`);

  await assert.rejects(() => mod.buatPembayaranQris({ amount: 0, orderId: "KSR-2" }));
  await assert.rejects(() => mod.buatPembayaranQris({ amount: -5, orderId: "KSR-2" }));
  await assert.rejects(() => mod.buatPembayaranQris({ amount: "abc", orderId: "KSR-2" }));
});

test("mode QRIS statis menghasilkan QR asli tapi TIDAK mengaku terverifikasi", async () => {
  process.env.MERCHANT_QRIS_PAYLOAD = "00020101021126610014ID.CO.QRIS.WWW";
  const mod = await import(`../server/services/payment.service.js?v=${Date.now() + 1}`);

  assert.equal(mod.modeQris(), "statis");
  const hasil = await mod.buatPembayaranQris({ amount: 20535, orderId: "KSR-3" });

  assert.ok(hasil.qrImage.startsWith("data:image/png;base64,"), "QR harus gambar sungguhan");
  assert.equal(hasil.terverifikasi, false, "QRIS statis tidak bisa memastikan pembayaran");
  assert.match(hasil.keterangan, /nominal tidak terkunci/i);
});

test("status pembayaran statis memperingatkan kasir untuk cek mutasi", async () => {
  process.env.MERCHANT_QRIS_PAYLOAD = "00020101021126610014ID.CO.QRIS.WWW";
  const mod = await import(`../server/services/payment.service.js?v=${Date.now() + 2}`);
  const s = mod.statusPembayaran();
  assert.equal(s.terverifikasi, false);
  assert.match(s.keterangan, /mutasi/i);
});

test("mode gateway sandbox menyatakan diri sandbox, bukan produksi", async () => {
  process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-CONTOH";
  process.env.MIDTRANS_IS_PRODUCTION = "false";
  const mod = await import(`../server/services/payment.service.js?v=${Date.now() + 3}`);

  const s = mod.statusPembayaran();
  assert.equal(s.mode, "gateway");
  assert.equal(s.lingkungan, "sandbox");
  assert.match(s.keterangan, /SANDBOX/);
  assert.match(s.keterangan, /jangan dipakai melayani pembeli/i);
});

test("WEBHOOK: tanda tangan palsu ditolak", async () => {
  process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-RAHASIA";
  const mod = await import(`../server/services/payment.service.js?v=${Date.now() + 10}`);

  assert.equal(mod.verifikasiTandaTanganWebhook({
    order_id: "ORD-1", status_code: "200", gross_amount: "20535.00",
    signature_key: "tanda-tangan-karangan"
  }), false);
});

test("WEBHOOK: tanda tangan sah diterima", async () => {
  const KUNCI = "SB-Mid-server-RAHASIA";
  process.env.MIDTRANS_SERVER_KEY = KUNCI;
  const mod = await import(`../server/services/payment.service.js?v=${Date.now() + 11}`);
  const crypto = await import("node:crypto");

  const order = "ORD-1", kode = "200", jumlah = "20535.00";
  const sah = crypto.createHash("sha512").update(`${order}${kode}${jumlah}${KUNCI}`).digest("hex");

  assert.equal(mod.verifikasiTandaTanganWebhook({
    order_id: order, status_code: kode, gross_amount: jumlah, signature_key: sah
  }), true);
});

test("WEBHOOK: field kurang atau gateway mati selalu ditolak", async () => {
  process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-RAHASIA";
  const mod = await import(`../server/services/payment.service.js?v=${Date.now() + 12}`);

  assert.equal(mod.verifikasiTandaTanganWebhook({}), false);
  assert.equal(mod.verifikasiTandaTanganWebhook({ order_id: "ORD-1" }), false);
  assert.equal(mod.verifikasiTandaTanganWebhook(null), false);

  delete process.env.MIDTRANS_SERVER_KEY;
  const tanpaKunci = await import(`../server/services/payment.service.js?v=${Date.now() + 13}`);
  assert.equal(tanpaKunci.verifikasiTandaTanganWebhook({
    order_id: "a", status_code: "200", gross_amount: "1", signature_key: "x"
  }), false, "tanpa kunci server, webhook tidak boleh dipercaya sama sekali");
});

test("WEBHOOK: capture yang ditandai perlu tinjauan TIDAK dianggap lunas", async () => {
  const mod = await import(`../server/services/payment.service.js?v=${Date.now() + 14}`);

  assert.equal(mod.bacaStatusWebhook({ transaction_status: "settlement" }).status, "lunas");
  assert.equal(mod.bacaStatusWebhook({ transaction_status: "capture", fraud_status: "accept" }).status, "lunas");
  assert.equal(mod.bacaStatusWebhook({ transaction_status: "capture", fraud_status: "challenge" }).status, "tidak-diketahui");
  assert.equal(mod.bacaStatusWebhook({ transaction_status: "expire" }).status, "gagal");
});
