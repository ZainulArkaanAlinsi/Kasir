/** Rute master produk. Baca: kasir & admin. Tulis: admin saja. */
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireRole, ROLES } from "../middleware/auth.js";
import * as products from "../services/product.service.js";

export const productsRouter = Router();

productsRouter.get("/", asyncHandler(async (_req, res) => {
  res.json({ data: await products.listProducts() });
}));

/** Dipakai fitur scan barcode: cari produk dari SKU. */
productsRouter.get("/sku/:sku", asyncHandler(async (req, res) => {
  res.json({ data: await products.findProductBySku(req.params.sku) });
}));

productsRouter.post("/", requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await products.createProduct(req.body, req.user.uid) });
}));

productsRouter.patch("/:id", requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  res.json({ data: await products.updateProduct(req.params.id, req.body) });
}));

productsRouter.delete("/:id", requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  res.json({ data: await products.deactivateProduct(req.params.id) });
}));
