import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import {
  type BusinessUserRole,
  BUSINESS_USER_ROLES,
  parseBusinessUserRole
} from "../types/auth";

const BCRYPT_ROUNDS = 12;

const ACCESS_ROLES = BUSINESS_USER_ROLES;

export type AccessTokenPayload = {
  userId: string;
  businessId: string;
  role: BusinessUserRole;
};

export type RefreshTokenPayload = {
  userId: string;
  sessionId: string;
};

function getAccessSecret(): string {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s) {
    throw new Error("JWT_ACCESS_SECRET no está definida");
  }
  return s;
}

function getRefreshSecret(): string {
  const s = process.env.JWT_REFRESH_SECRET;
  if (!s) {
    throw new Error("JWT_REFRESH_SECRET no está definida");
  }
  return s;
}

function accessExpiresIn(): string {
  return process.env.JWT_ACCESS_EXPIRES ?? "15m";
}

function refreshExpiresIn(): string {
  return process.env.JWT_REFRESH_EXPIRES ?? "7d";
}

function refreshExpiresMs(): number {
  const raw = process.env.JWT_REFRESH_EXPIRES_MS;
  if (raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("JWT_REFRESH_EXPIRES_MS inválido");
    }
    return n;
  }
  return 7 * 24 * 60 * 60 * 1000;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(plain, passwordHash);
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const signOptions: jwt.SignOptions = {
    expiresIn: accessExpiresIn() as jwt.SignOptions["expiresIn"],
    algorithm: "HS256"
  };
  return jwt.sign(
    {
      userId: payload.userId,
      businessId: payload.businessId,
      role: payload.role
    },
    getAccessSecret(),
    signOptions
  );
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const signOptions: jwt.SignOptions = {
    expiresIn: refreshExpiresIn() as jwt.SignOptions["expiresIn"],
    algorithm: "HS256"
  };
  return jwt.sign(
    {
      userId: payload.userId,
      sessionId: payload.sessionId
    },
    getRefreshSecret(),
    signOptions
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, getAccessSecret(), {
    algorithms: ["HS256"]
  }) as jwt.JwtPayload & AccessTokenPayload;
  if (
    !decoded.userId ||
    !decoded.businessId ||
    !decoded.role ||
    !ACCESS_ROLES.includes(decoded.role as BusinessUserRole)
  ) {
    throw new Error("INVALID_ACCESS_TOKEN");
  }
  return {
    userId: decoded.userId,
    businessId: decoded.businessId,
    role: parseBusinessUserRole(decoded.role)
  };
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, getRefreshSecret(), {
    algorithms: ["HS256"]
  }) as jwt.JwtPayload & RefreshTokenPayload;
  if (!decoded.userId || !decoded.sessionId) {
    throw new Error("INVALID_REFRESH_TOKEN");
  }
  return {
    userId: decoded.userId,
    sessionId: decoded.sessionId
  };
}

async function pickMembership(userId: string, businessId?: string) {
  const memberships = await prisma.business_user.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "asc" }
  });
  if (memberships.length === 0) {
    throw new Error("NO_MEMBERSHIPS");
  }
  if (memberships.length === 1) {
    return memberships[0];
  }
  if (!businessId) {
    throw new Error("BUSINESS_ID_REQUIRED");
  }
  const row = memberships.find((m) => m.business_id === businessId);
  if (!row) {
    throw new Error("MEMBERSHIP_NOT_FOUND");
  }
  return row;
}

export async function login(
  email: string,
  password: string,
  businessId?: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.appUser.findUnique({
    where: { email: normalizedEmail }
  });
  if (!user) {
    throw new Error("INVALID_CREDENTIALS");
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const membership = await pickMembership(user.id, businessId);

  const expiresAt = new Date(Date.now() + refreshExpiresMs());
  const session = await prisma.user_session.create({
    data: {
      user_id: user.id,
      business_user_id: membership.id,
      expires_at: expiresAt
    }
  });

  const accessToken = signAccessToken({
    userId: user.id,
    businessId: membership.business_id,
    role: parseBusinessUserRole(membership.role)
  });
  const refreshToken = signRefreshToken({
    userId: user.id,
    sessionId: session.id
  });

  return { accessToken, refreshToken };
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string }> {
  let payload: RefreshTokenPayload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new Error("INVALID_REFRESH_TOKEN");
  }

  const session = await prisma.user_session.findFirst({
    where: {
      id: payload.sessionId,
      user_id: payload.userId,
      expires_at: { gt: new Date() }
    },
    include: { business_user: true }
  });

  if (!session) {
    throw new Error("SESSION_INVALID");
  }

  const bu = session.business_user;
  const accessToken = signAccessToken({
    userId: session.user_id,
    businessId: bu.business_id,
    role: parseBusinessUserRole(bu.role)
  });

  return { accessToken };
}

export async function logout(refreshToken: string): Promise<void> {
  let payload: RefreshTokenPayload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new Error("INVALID_REFRESH_TOKEN");
  }

  await prisma.user_session.deleteMany({
    where: {
      id: payload.sessionId,
      user_id: payload.userId
    }
  });
}
