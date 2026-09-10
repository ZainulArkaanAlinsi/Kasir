/** Rute transaksi penjualan — satu-satunya jalan sah untuk mengubah stok. */
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { cashierFrom } from "../middleware/auth.js";
import { createTransaction, listTransactions } from "../services/transaction.service.js";
import { requireDateRange } from "../lib/validate.js";

export const transactionsRouter = Router();

transactionsRouter.post("/", asyncHandler(async (req, res) => {
  const trx = await createTransaction({ ...req.body, cashier: cashierFrom(req) });
  res.status(201).json({ data: trx });
}));

transactionsRouter.get("/", asyncHandler(async (req, res) => {
  const filter = { limit: Number(req.query.limit) || 100 };
  if (req.query.from && req.query.to) {
    const { from, to } = requireDateRange(req.query.from, req.query.to);
    Object.assign(filter, { from, to });
  }
  if (req.query.cashierUid) filter.cashierUid = String(req.query.cashierUid);
  res.json({ data: await listTransactions(filter) });
}));
