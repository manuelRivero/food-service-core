import type { Request, Response } from "express";
import {
  addArrivals,
  closeReservation,
  getCheckinPayload,
  isValidReservationToken,
  removeArrivals
} from "../services/checkin.service";

export async function getCheckin(req: Request, res: Response) {
  const { token } = req.params;
  if (!token || !isValidReservationToken(token)) {
    return res.status(400).json({ error: "Token inválido" });
  }

  const payload = await getCheckinPayload(token);
  if (!payload) {
    return res.status(404).json({ error: "Reserva no encontrada" });
  }

  return res.json(payload);
}

export async function postCheckinAdd(req: Request, res: Response) {
  const { token } = req.params;
  if (!token || !isValidReservationToken(token)) {
    return res.status(400).json({ error: "Token inválido" });
  }

  const count = (req.body as { count?: unknown })?.count;
  try {
    await addArrivals(token, count);
  } catch (e) {
    if ((e as Error).message === "NOT_FOUND") {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }
    if ((e as Error).message === "CLOSED") {
      return res.status(409).json({ error: "La reserva está cerrada" });
    }
    if ((e as Error).message === "INVALID_COUNT") {
      return res.status(400).json({ error: "count debe ser un entero positivo" });
    }
    throw e;
  }

  const payload = await getCheckinPayload(token);
  return res.json(payload);
}

export async function postCheckinRemove(req: Request, res: Response) {
  const { token } = req.params;
  if (!token || !isValidReservationToken(token)) {
    return res.status(400).json({ error: "Token inválido" });
  }

  const count = (req.body as { count?: unknown })?.count;
  try {
    await removeArrivals(token, count);
  } catch (e) {
    if ((e as Error).message === "NOT_FOUND") {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }
    if ((e as Error).message === "CLOSED") {
      return res.status(409).json({ error: "La reserva está cerrada" });
    }
    if ((e as Error).message === "INVALID_COUNT") {
      return res.status(400).json({ error: "count debe ser un entero positivo" });
    }
    throw e;
  }

  const payload = await getCheckinPayload(token);
  return res.json(payload);
}

export async function postCheckinClose(req: Request, res: Response) {
  const { token } = req.params;
  if (!token || !isValidReservationToken(token)) {
    return res.status(400).json({ error: "Token inválido" });
  }

  const updated = await closeReservation(token);
  if (!updated) {
    return res.status(404).json({ error: "Reserva no encontrada" });
  }

  const payload = await getCheckinPayload(token);
  return res.json(payload);
}
