import crypto from "crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  bookings,
  customers,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const CUSTOMER_COOKIE = "wsh_customer_session";
const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

function hashAccessToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function generateAccessToken(): string {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

export async function POST(
  req: Request,
) {
  try {
    const body = (await req
      .json()
      .catch(() => null)) as {
      accessCode?: unknown;
    } | null;

    const accessCode =
      typeof body?.accessCode === "string"
        ? body.accessCode.trim()
        : "";

    if (!/^\d{4}$/.test(accessCode)) {
      return NextResponse.json(
        {
          error:
            "Enter the 4-digit access code given to you by staff.",
        },
        {
          status: 400,
        },
      );
    }

    const [booking] = await db
      .select({
        id: bookings.id,
        customerId: bookings.customerId,
        deskId: bookings.deskId,
        checkedInAt: bookings.checkedInAt,
        status: bookings.status,
        customerName: customers.name,
      })
      .from(bookings)
      .innerJoin(
        customers,
        eq(
          customers.id,
          bookings.customerId,
        ),
      )
      .where(
        and(
          eq(
            bookings.accessCode,
            accessCode,
          ),
          eq(
            bookings.status,
            "active",
          ),
        ),
      )
      .limit(1);

    if (!booking) {
      return NextResponse.json(
        {
          error:
            "Invalid or expired access code.",
        },
        {
          status: 401,
        },
      );
    }

    const accessToken =
      generateAccessToken();
    const accessTokenHash =
      hashAccessToken(accessToken);
    const createdAt =
      new Date();

    await db
      .update(bookings)
      .set({
        accessTokenHash,
        accessTokenCreatedAt:
          createdAt,
      })
      .where(
        and(
          eq(
            bookings.id,
            booking.id,
          ),
          eq(
            bookings.status,
            "active",
          ),
        ),
      );

    const response = NextResponse.json({
      ok: true,
      booking: {
        id: booking.id,
        customerId:
          booking.customerId,
        customerName:
          booking.customerName,
        deskId:
          booking.deskId,
        checkedInAt:
          booking.checkedInAt.toISOString(),
      },
    });

    response.cookies.set(
      CUSTOMER_COOKIE,
      accessToken,
      {
        httpOnly: true,
        sameSite: "lax",
        secure:
          process.env.NODE_ENV ===
          "production",
        path: "/",
        maxAge:
          COOKIE_MAX_AGE_SECONDS,
      },
    );

    return response;
  } catch (error) {
    console.error(
      "Public customer session verification error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not verify the customer session.",
      },
      {
        status: 500,
      },
    );
  }
}
