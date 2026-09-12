import { NextResponse } from "next/server";
import crypto from "crypto";

import { db } from "@/db";
import {
  desks,
  categories,
  products,
  bookings,
  customers,
} from "@/db/schema";

import { and, asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const CUSTOMER_COOKIE = "wsh_customer_session";

function hashAccessToken(token: string) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function getCookieValue(
  cookieHeader: string | null,
  name: string,
) {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader
    .split(";")
    .map((part) => part.trim());

  const target = `${name}=`;

  for (const part of parts) {
    if (part.startsWith(target)) {
      return decodeURIComponent(
        part.slice(target.length),
      );
    }
  }

  return null;
}

/**
 * Public endpoint reached by a customer scanning a desk/table/room QR.
 *
 * IMPORTANT:
 * The QR identifies the physical location only.
 * It does NOT identify the customer's booking.
 *
 * The active customer session is identified from the secure
 * HttpOnly device cookie created during the connection flow.
 */
export async function GET(
  req: Request,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  },
) {
  try {
    const { id } = await params;

    const deskId = Number(id);

    if (!Number.isInteger(deskId) || deskId <= 0) {
      return NextResponse.json(
        {
          error: "Invalid location id",
        },
        { status: 400 },
      );
    }

    // -------------------------------------------------------------------------
    // FIND PHYSICAL LOCATION
    // -------------------------------------------------------------------------

    const [desk] = await db
      .select({
        id: desks.id,
        name: desks.name,
        type: desks.type,
        active: desks.active,
      })
      .from(desks)
      .where(
        and(
          eq(desks.id, deskId),
          eq(desks.active, true),
        ),
      )
      .limit(1);

    if (!desk) {
      return NextResponse.json(
        {
          error: "Location not found",
        },
        { status: 404 },
      );
    }

    // -------------------------------------------------------------------------
    // FIND CUSTOMER SESSION FROM SECURE DEVICE COOKIE
    // -------------------------------------------------------------------------

    const rawToken = getCookieValue(
      req.headers.get("cookie"),
      CUSTOMER_COOKIE,
    );

    let activeBooking:
      | {
          id: number;
          customerName: string;
          checkedInAt: Date;
        }
      | undefined;

    if (rawToken) {
      const tokenHash =
        hashAccessToken(rawToken);

      const [booking] = await db
        .select({
          id: bookings.id,
          customerName: customers.name,
          checkedInAt: bookings.checkedInAt,
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
              bookings.accessTokenHash,
              tokenHash,
            ),
            eq(
              bookings.status,
              "active",
            ),
          ),
        )
        .limit(1);

      activeBooking = booking;
    }

    // -------------------------------------------------------------------------
    // MENU
    // -------------------------------------------------------------------------

    const cats = await db
      .select()
      .from(categories)
      .orderBy(
        asc(categories.sortOrder),
      );

    const prods = await db
      .select()
      .from(products)
      .where(
        eq(products.active, true),
      )
      .orderBy(
        asc(products.name),
      );

    // -------------------------------------------------------------------------
    // RESPONSE
    // -------------------------------------------------------------------------

    return NextResponse.json({
      desk: {
        id: desk.id,
        name: desk.name,
        type: desk.type,
      },

      // This is the customer's SESSION.
      // It is intentionally independent from the scanned location.
      booking: activeBooking
        ? {
            id: activeBooking.id,
            customerName:
              activeBooking.customerName,
            checkedInAt:
              activeBooking.checkedInAt,
          }
        : null,

      categories: cats.map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
      })),

      products: prods.map((p) => ({
        id: p.id,
        categoryId: p.categoryId,
        name: p.name,
        price: p.price,
        icon: p.icon,
        imageUrl: p.imageUrl,
      })),
    });
  } catch (error) {
    console.error(
      "Public menu failed:",
      error,
    );

    return NextResponse.json(
      {
        error: "Could not load menu.",
      },
      { status: 500 },
    );
  }
}