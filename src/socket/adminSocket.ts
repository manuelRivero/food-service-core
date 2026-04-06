import { parse } from "cookie";
import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import { ACCESS_COOKIE_NAME } from "../lib/authCookies";
import { verifyAccessToken } from "../services/auth.service";

const LOG = "[adminSocket]";

let io: Server | null = null;

function handshakeDebug(socket: Socket): string {
  const h = socket.handshake.headers;
  const hasAuthToken =
    typeof socket.handshake.auth === "object" &&
    socket.handshake.auth !== null &&
    typeof (socket.handshake.auth as { token?: unknown }).token === "string" &&
    String((socket.handshake.auth as { token?: string }).token).length > 0;
  const hasBearer = typeof h.authorization === "string" && /^Bearer\s+\S+/i.test(h.authorization);
  const hasCookieHeader = typeof h.cookie === "string" && h.cookie.length > 0;
  const hasAccessCookie =
    hasCookieHeader &&
    Boolean(parse(h.cookie!)[ACCESS_COOKIE_NAME]);
  return `auth.token=${hasAuthToken} bearer=${hasBearer} cookieHeader=${hasCookieHeader} accessCookie=${hasAccessCookie}`;
}

function roomSize(server: Server, room: string): number {
  return server.sockets.adapter.rooms.get(room)?.size ?? 0;
}

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
    console.warn(`${LOG} attachAdminSocket: ya inicializado (idempotente)`);
    return io;
  }

  const corsOrigins = parseCorsOrigins();
  console.log(
    `${LOG} inicializando path=/socket.io corsOrigin=${JSON.stringify(corsOrigins)} cookieName=${ACCESS_COOKIE_NAME}`
  );

  io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: corsOrigins,
      credentials: true,
      methods: ["GET", "POST"]
    }
  });

  io.engine.on("connection_error", (err) => {
    console.error(`${LOG} engine connection_error`, err.req?.url, err.message);
  });

  io.use((socket, next) => {
    const token = getTokenFromHandshake(socket);
    const xfProto = socket.handshake.headers["x-forwarded-proto"];
    const host = socket.handshake.headers.host;
    if (!token) {
      console.warn(
        `${LOG} handshake rechazado: sin token socket.id=${socket.id} ${handshakeDebug(socket)} transport=${socket.conn.transport.name} host=${host ?? "?"} x-forwarded-proto=${xfProto ?? "?"}`
      );
      next(new Error("UNAUTHORIZED"));
      return;
    }
    try {
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.userId;
      socket.data.businessId = payload.businessId;
      socket.data.role = payload.role;
      console.log(
        `${LOG} handshake ok socket.id=${socket.id} userId=${payload.userId} businessId=${payload.businessId} role=${payload.role}`
      );
      next();
    } catch (e) {
      const name = e instanceof Error ? e.name : "Error";
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `${LOG} handshake rechazado: JWT inválido socket.id=${socket.id} ${handshakeDebug(socket)} err=${name} ${msg}`
      );
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const businessId = socket.data.businessId as string | undefined;
    if (!businessId) {
      console.warn(`${LOG} connection sin businessId, desconectando socket.id=${socket.id}`);
      socket.disconnect(true);
      return;
    }
    const room = adminRoom(businessId);
    void Promise.resolve(socket.join(room)).then(() => {
      const size = roomSize(io!, room);
      console.log(
        `${LOG} cliente en sala socket.id=${socket.id} room=${room} roomSize=${size} transport=${socket.conn.transport.name}`
      );
    });
  });

  return io;
}

export function emitAdminReservationCreated(
  businessId: string,
  payload: { reservationId: string }
): void {
  if (!io) {
    console.error(
      `${LOG} emit admin:reservation OMITIDO: Socket.IO no inicializado (¿attachAdminSocket antes de listen?) businessId=${businessId} reservationId=${payload.reservationId}`
    );
    return;
  }
  const room = adminRoom(businessId);
  const before = roomSize(io, room);
  const body = {
    type: "reservation.created" as const,
    businessId,
    reservationId: payload.reservationId,
    at: new Date().toISOString()
  };
  io.to(room).emit("admin:reservation", body);
  const after = roomSize(io, room);
  console.log(
    `${LOG} emit admin:reservation room=${room} reservationId=${payload.reservationId} socketsEnSala=${before} (tras emit, mismos clientes conectados=${after})`
  );
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
    console.error(
      `${LOG} emit admin:order OMITIDO: Socket.IO no inicializado businessId=${businessId} orderId=${payload.orderId}`
    );
    return;
  }
  const room = adminRoom(businessId);
  const before = roomSize(io, room);
  const body = {
    type: "order.created" as const,
    businessId,
    orderId: payload.orderId,
    total: payload.total,
    currency: payload.currency,
    at: new Date().toISOString()
  };
  io.to(room).emit("admin:order", body);
  const after = roomSize(io, room);
  console.log(
    `${LOG} emit admin:order room=${room} orderId=${payload.orderId} socketsEnSala=${before} (tras emit=${after})`
  );
}
