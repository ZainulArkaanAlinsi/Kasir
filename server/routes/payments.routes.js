/** Rute pembayaran QRIS. */
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { buatPembayaranQris, cekStatusQris, statusPembayaran } from "../services/payment.service.js";

export const paymentsRouter = Router();

/** Status konfigurasi — dipakai UI untuk jujur soal mode yang aktif. */
paymentsRouter.get("/status", (_req, res) => {
  res.json({ data: statusPembayaran() });
});

/** Membuat QR untuk satu tagihan. */
paymentsRouter.post("/qris", asyncHandler(async (req, res) => {
  const data = await buatPembayaranQris({
    amount: req.body?.amount,
    orderId: req.body?.orderId
  });
  res.status(201).json({ data });
}));

/** Memeriksa apakah tagihan sudah lunas. */
paymentsRouter.get("/qris/:orderId/status", asyncHandler(async (req, res) => {
  res.json({ data: await cekStatusQris(req.params.orderId) });
}));
