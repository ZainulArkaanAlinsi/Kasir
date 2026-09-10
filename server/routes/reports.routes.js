/** Rute laporan agregat. Angka dihitung server, bukan di browser. */
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireRole, ROLES } from "../middleware/auth.js";
import { buildReport, resolvePeriod } from "../services/report.service.js";
import { requireDateRange, requireEnum } from "../lib/validate.js";

export const reportsRouter = Router();

/**
 * GET /api/reports?period=week
 * GET /api/reports?from=2026-09-01&to=2026-09-30
 * Laba & modal hanya boleh dilihat admin.
 */
reportsRouter.get("/", requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const range = req.query.from && req.query.to
    ? requireDateRange(req.query.from, req.query.to)
    : resolvePeriod(requireEnum(req.query.period || "week", "Periode", ["today", "week", "month"]));
  res.json({ data: await buildReport(range) });
}));
