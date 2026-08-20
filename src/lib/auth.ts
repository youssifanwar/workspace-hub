import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/db";
import { sessionsTable, users } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";

export const SESSION_COOKIE = "workspace_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export type Role = "admin" | "manager" | "employee";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const derived = scryptSync(password, salt, 64);
    const hashBuf = Buffer.from(hash, "hex");
    if (derived.length !== hashBuf.length) return false;
    return timingSafeEqual(derived, hashBuf);
  } catch {
    return false;
  }
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(48).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await db.insert(sessionsTable).values({ token, userId, expiresAt });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
  }
  cookieStore.delete(SESSION_COOKIE);
}

export type SessionUser = {
  id: number;
  username: string;
  fullName: string;
  role: Role;
};

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      active: users.active,
      expiresAt: sessionsTable.expiresAt,
    })
    .from(sessionsTable)
    .innerJoin(users, eq(users.id, sessionsTable.userId))
    .where(
      and(
        eq(sessionsTable.token, token),
        gt(sessionsTable.expiresAt, Date.now()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.active) return null;
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    role: row.role as Role,
  };
}

export function canManage(role: Role): boolean {
  return role === "admin" || role === "manager";
}

export function isAdmin(role: Role): boolean {
  return role === "admin";
}
