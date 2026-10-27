import crypto from "crypto";
import { sql, type SQL } from "drizzle-orm";

import { bookings } from "@/db/schema";

export const CUSTOMER_COOKIE = "wsh_customer_session";
export const CUSTOMER_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Safety ceiling on how many devices can join one booking. */
export const MAX_DEVICES_PER_BOOKING = 100;

/** Failed code attempts allowed per IP in the window below. */
export const MAX_FAILED_ATTEMPTS = 10;
export const ATTEMPT_WINDOW_MINUTES = 10;

export function hashAccessToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateAccessToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(`ip:${ip}`).digest("hex");
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function getCookieValue(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const target = `${name}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) {
      try {
        return decodeURIComponent(trimmed.slice(target.length)) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * SQL condition: "this token belongs to this booking".
 *
 * A token is valid if it is one of the booking's device sessions, OR it is
 * the legacy single token stored directly on the booking (sessions created
 * before multi-device support keep working until they end).
 */
export function bookingAccessCondition(tokenHash: string): SQL {
  return sql`(
    ${bookings.accessTokenHash} = ${tokenHash}
    OR EXISTS (
      SELECT 1
      FROM booking_access_sessions bas
      WHERE bas.booking_id = ${bookings.id}
        AND bas.token_hash = ${tokenHash}
    )
  )`;
}
