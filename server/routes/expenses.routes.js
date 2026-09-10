/** Rute pengeluaran & restock. Admin saja — ini menyangkut modal toko. */
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireRole, ROLES } from "../middleware/auth.js";
import { createExpense, listExpenses, restockProduct } from "../services/expense.service.js";
import { requireDateRange } from "../lib/validate.js";

export const expensesRouter = Router();

expensesRouter.use(requireRole(ROLES.ADMIN));

expensesRouter.post("/", asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createExpense(req.body, req.user) });
}));

expensesRouter.post("/restock", asyncHandler(async (req, res) => {
  res.status(201).json({ data: await restockProduct(req.body, req.user) });
}));

expensesRouter.get("/", asyncHandler(async (req, res) => {
  const filter = { limit: Number(req.query.limit) || 100 };
  if (req.query.from && req.query.to) {
    const { from, to } = requireDateRange(req.query.from, req.query.to);
    Object.assign(filter, { from, to });
  }
  res.json({ data: await listExpenses(filter) });
}));
