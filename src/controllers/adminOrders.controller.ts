import type { Request, Response } from "express";
import { z } from "zod";
import {
  getAdminOrderById,
  listAdminOrders
} from "../services/adminOrders.service";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  orderId: z.string().uuid().optional(),
  dateFrom: z.string().min(1).optional(),
  dateTo: z.string().min(1).optional(),
  customerPhone: z.string().min(1).optional()
});

export async function getOrders(req: Request, res: Response) {
  const businessId = req.user?.businessId;
  if (!businessId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Parámetros inválidos",
      details: parsed.error.flatten()
    });
  }

  const q = parsed.data;
  try {
    const result = await listAdminOrders({
      businessId,
      page: q.page,
      pageSize: q.pageSize,
      orderId: q.orderId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      customerPhone: q.customerPhone
    });
    return res.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "INVALID_DATE_FROM" || msg === "INVALID_DATE_TO") {
      return res.status(400).json({ error: "Fecha inválida (dateFrom / dateTo)" });
    }
    throw e;
  }
}

const idParamSchema = z.object({
  id: z.string().uuid()
});

export async function getOrderById(req: Request, res: Response) {
  const businessId = req.user?.businessId;
  if (!businessId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "id de orden inválido" });
  }

  const order = await getAdminOrderById(businessId, parsed.data.id);
  if (!order) {
    return res.status(404).json({ error: "Orden no encontrada" });
  }

  return res.json(order);
}
