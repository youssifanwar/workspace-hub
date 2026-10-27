import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  accessCodeAttempts,
  bookingAccessSessions,
  bookings,
  customers,
} from "@/db/schema";
import {
  ATTEMPT_WINDOW_MINUTES,
  CUSTOMER_COOKIE,
  CUSTOMER_COOKIE_MAX_AGE_SECONDS,
  MAX_DEVICES_PER_BOOKING,
  MAX_FAILED_ATTEMPTS,
  generateAccessToken,
  getClientIp,
  hashAccessToken,
  hashIp,
} from "@/lib/customer-session";

export const dynamic = "force-dynamic";

/**
 * A customer enters the 4-digit code shown by staff. Every device that does
 * so gets its OWN independent session, attached to the same booking — a
 * second person joining never logs out the first, and all their orders land
 * on the one booking (one bill).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      accessCode?: unknown;
    } | null;

    const accessCode =
      typeof body?.accessCode === "string" ? body.accessCode.trim() : "";

    if (!/^\d{4}$/.test(accessCode)) {
      return NextResponse.json(
        { error: "Enter the 4-digit access code given to you by staff." },
        { status: 400 },
      );
    }

    // ---- throttle code guessing (per IP) -------------------------------
    const ipHash = hashIp(getClientIp(req));
    const [recent] = await db
      .select({ failures: sql<number>`count(*)::int` })
      .from(accessCodeAttempts)
      .where(
        and(
          eq(accessCodeAttempts.ipHash, ipHash),
          eq(accessCodeAttempts.success, false),
          sql`${accessCodeAttempts.createdAt} > now() - make_interval(mins => ${ATTEMPT_WINDOW_MINUTES})`,
        ),
      );

    if ((recent?.failures ?? 0) >= MAX_FAILED_ATTEMPTS) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait a few minutes and try again." },
        { status: 429 },
      );
    }

    const [booking] = await db
      .select({
        id: bookings.id,
        customerId: bookings.customerId,
        deskId: bookings.deskId,
        checkedInAt: bookings.checkedInAt,
        customerName: customers.name,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(
        and(
          eq(bookings.accessCode, accessCode),
          eq(bookings.status, "active"),
        ),
      )
      .limit(1);

    if (!booking) {
      await db
        .insert(accessCodeAttempts)
        .values({ ipHash, success: false })
        .catch(() => undefined);

      return NextResponse.json(
        { error: "Invalid or expired access code." },
        { status: 401 },
      );
    }

    const [{ devices }] = await db
      .select({ devices: sql<number>`count(*)::int` })
      .from(bookingAccessSessions)
      .where(eq(bookingAccessSessions.bookingId, booking.id));

    if (devices >= MAX_DEVICES_PER_BOOKING) {
      return NextResponse.json(
        { error: "This session has reached its device limit. Ask the staff for help." },
        { status: 409 },
      );
    }

    const accessToken = generateAccessToken();

    await db.insert(bookingAccessSessions).values({
      bookingId: booking.id,
      tokenHash: hashAccessToken(accessToken),
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300) || null,
    });

    await db
      .insert(accessCodeAttempts)
      .values({ ipHash, success: true })
      .catch(() => undefined);

    // Opportunistic cleanup keeps the attempts table small.
    await db
      .delete(accessCodeAttempts)
      .where(sql`${accessCodeAttempts.createdAt} < now() - interval '2 days'`)
      .catch(() => undefined);

    const response = NextResponse.json({
      ok: true,
      booking: {
        id: booking.id,
        customerId: booking.customerId,
        customerName: booking.customerName,
        deskId: booking.deskId,
        checkedInAt: booking.checkedInAt.toISOString(),
      },
    });

    response.cookies.set(CUSTOMER_COOKIE, accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CUSTOMER_COOKIE_MAX_AGE_SECONDS,
    });

    return response;
  } catch (error) {
    // Technical detail goes to the server log only — never to the customer.
    console.error("Public customer session verification error:", error);
    return NextResponse.json(
      { error: "Could not verify the access code. Please try again." },
      { status: 500 },
    );
  }
}
