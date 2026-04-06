import { parse } from "cookie";
import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import { ACCESS_COOKIE_NAME } from "../lib/authCookies";
import { verifyAccessToken } from "../services/auth.service";

let io: Server | null = null;

function adminRoom(businessId: string): string {
  return `admin:${businessId}`;
}

function getTokenFromHandshake(socket: Socket): string | undefined {
  const auth = socket.handshake.auth;
  if (typeof auth === "object" && auth !== null) {
    const t = (auth as { token?: unknown }).token;
    if (typeof t === "string" && t.length > 0) {
      return t;
    }
  }
  const authHeader = socket.handshake.headers.authorization;
  if (typeof authHeader === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (m?.[1]) {
      return m[1];
    }
  }
  const rawCookie = socket.handshake.headers.cookie;
  if (typeof rawCookie === "string") {
    const cookies = parse(rawCookie);
    const c = cookies[ACCESS_COOKIE_NAME];
    if (typeof c === "string" && c.length > 0) {
      return c;
    }
  }
  return undefined;
}

function parseCorsOrigins(): string[] | boolean {
  const raw = process.env.CORS_ORIGIN ?? "http://localhost:3000";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) {
    return true;
  }
  return list;
}

/**
 * Socket.IO para el panel admin: sala por negocio `admin:<businessId>`.
 * Cliente: `io(url, { auth: { token }, withCredentials: true })` o cookie HttpOnly.
 */
export function attachAdminSocket(httpServer: HttpServer): Server {
  if (io) {
    return io;
  }

  io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: parseCorsOrigins(),
      credentials: true,
      methods: ["GET", "POST"]
    }
  });

  io.use((socket, next) => {
    const token = getTokenFromHandshake(socket);
    if (!token) {
      next(new Error("UNAUTHORIZED"));
      return;
    }
    try {
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.userId;
      socket.data.businessId = payload.businessId;
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const businessId = socket.data.businessId as string | undefined;
    if (!businessId) {
      socket.disconnect(true);
      return;
    }
    void socket.join(adminRoom(businessId));
  });

  return io;
}

export function emitAdminReservationCreated(
  businessId: string,
  payload: { reservationId: string }
): void {
  if (!io) {
    return;
  }
  io.to(adminRoom(businessId)).emit("admin:reservation", {
    type: "reservation.created",
    businessId,
    reservationId: payload.reservationId,
    at: new Date().toISOString()
  });
}

export function emitAdminOrderCreated(
  businessId: string,
  payload: {
    orderId: string;
    total: string;
    currency: string;
  }
): void {
  if (!io) {
    return;
  }
  io.to(adminRoom(businessId)).emit("admin:order", {
    type: "order.created",
    businessId,
    orderId: payload.orderId,
    total: payload.total,
    currency: payload.currency,
    at: new Date().toISOString()
  });
}
