/**
 * Rute pesanan online.
 *
 * Hak akses dibedakan tegas: pelanggan hanya menyentuh pesanannya sendiri,
 * staf toko mengurus semuanya. Pemeriksaannya ada di service, bukan di sini,
 * supaya aturan yang sama berlaku dari mana pun fungsi itu dipanggil.
 */
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireRole, ROLES } from "../middleware/auth.js";
import {
  buatPesanan, ubahStatus, daftarPesanan, ambilPesanan,
  bersihkanKedaluwarsa, hitungOngkir, STATUS, CARA_AMBIL
} from "../services/order.service.js";

export const ordersRouter = Router();

/** Pilihan pengiriman dan tarifnya, supaya etalase tidak menebak angka. */
ordersRouter.get("/opsi-pengiriman", (_req, res) => {
  res.json({
    data: {
      cara: CARA_AMBIL,
      zona: ["dalam_kota", "luar_kota"],
      tarif: {
        pickup: 0,
        dalam_kota: hitungOngkir("delivery", "dalam_kota"),
        luar_kota: hitungOngkir("delivery", "luar_kota")
      }
    }
  });
});

/** Pelanggan membuat pesanan. */
ordersRouter.post("/", asyncHandler(async (req, res) => {
  const pesanan = await buatPesanan({
    items: req.body?.items,
    pengiriman: req.body?.pengiriman,
    pelanggan: {
      uid: req.user.uid,
      name: req.user.name || req.userProfile?.displayName || req.user.email || "Pelanggan",
      phone: req.body?.telepon ?? null
    }
  });
  res.status(201).json({ data: pesanan });
}));

/** Daftar pesanan; pelanggan otomatis disaring ke miliknya sendiri. */
ordersRouter.get("/", asyncHandler(async (req, res) => {
  const filter = { limit: Number(req.query.limit) || 50 };
  if (req.query.status) filter.status = String(req.query.status);

  // Penyaringan dipaksa di sini, bukan dipercayakan pada query string.
  if (req.userRole === ROLES.CUSTOMER) filter.customerUid = req.user.uid;
  else if (req.query.customerUid) filter.customerUid = String(req.query.customerUid);

  res.json({ data: await daftarPesanan(filter) });
}));

ordersRouter.get("/:id", asyncHandler(async (req, res) => {
  const data = await ambilPesanan(req.params.id, { uid: req.user.uid, role: req.userRole });
  res.json({ data });
}));

/** Perubahan status. Service yang memutuskan apakah aktornya berhak. */
ordersRouter.patch("/:id/status", asyncHandler(async (req, res) => {
  const data = await ubahStatus(
    req.params.id,
    req.body?.status,
    { uid: req.user.uid, role: req.userRole },
    { paymentMethod: req.body?.paymentMethod, paymentRef: req.body?.paymentRef }
  );
  res.json({ data });
}));

/** Membersihkan pesanan yang lewat batas waktu bayar. Staf toko saja. */
ordersRouter.post("/bersihkan-kedaluwarsa", requireRole(ROLES.ADMIN), asyncHandler(async (_req, res) => {
  res.json({ data: await bersihkanKedaluwarsa() });
}));

export { STATUS as ORDER_STATUS };
