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

const CUSTOMER_COOKIE =
  "wsh_customer_session";

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

async function withTimeout<T>(
  name: string,
  promise: Promise<T>,
  timeoutMs = 5000,
): Promise<T> {
  console.log(
    `[PublicMenu] START ${name}`,
  );

  let timeoutId: NodeJS.Timeout | null =
    null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `${name} timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    console.log(
      `[PublicMenu] END ${name}`,
    );
  }
}

/**
 * Public endpoint reached when a customer
 * scans a desk/table/room QR.
 *
 * The QR identifies the physical location only.
 * The customer's active booking is identified
 * using the secure customer-session cookie.
 */
export async function GET(
  req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  console.log(
    "[PublicMenu] ===== REQUEST START =====",
  );

  try {
    const { id } = await params;

    console.log(
      "[PublicMenu] Route id:",
      id,
    );

    const deskId = Number(id);

    if (
      !Number.isInteger(deskId) ||
      deskId <= 0
    ) {
      console.log(
        "[PublicMenu] Invalid desk id:",
        deskId,
      );

      return NextResponse.json(
        {
          error:
            "Invalid location id",
        },
        { status: 400 },
      );
    }

    console.log(
      "[PublicMenu] Valid desk id:",
      deskId,
    );

    // -------------------------------------------------------------------------
    // FIND PHYSICAL LOCATION
    // -------------------------------------------------------------------------

    const deskRows =
      await withTimeout(
        "DESK QUERY",
        db
          .select({
            id: desks.id,
            name: desks.name,
            type: desks.type,
            active: desks.active,
          })
          .from(desks)
          .where(
            and(
              eq(
                desks.id,
                deskId,
              ),
              eq(
                desks.active,
                true,
              ),
            ),
          )
          .limit(1),
      );

    const desk = deskRows[0];

    console.log(
      "[PublicMenu] Desk result:",
      desk,
    );

    if (!desk) {
      return NextResponse.json(
        {
          error:
            "Location not found",
        },
        { status: 404 },
      );
    }

    // -------------------------------------------------------------------------
    // FIND CUSTOMER SESSION
    // -------------------------------------------------------------------------

    const rawToken =
      getCookieValue(
        req.headers.get("cookie"),
        CUSTOMER_COOKIE,
      );

    console.log(
      "[PublicMenu] Customer cookie:",
      rawToken
        ? "PRESENT"
        : "NOT PRESENT",
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

      console.log(
        "[PublicMenu] Session token hash generated",
      );

      const bookingRows =
        await withTimeout(
          "BOOKING QUERY",
          db
            .select({
              id: bookings.id,
              customerName:
                customers.name,
              checkedInAt:
                bookings.checkedInAt,
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
            .limit(1),
        );

      activeBooking =
        bookingRows[0];

      console.log(
        "[PublicMenu] Booking result:",
        activeBooking
          ? activeBooking.id
          : "NONE",
      );
    }

    // -------------------------------------------------------------------------
    // CATEGORIES
    // -------------------------------------------------------------------------

    const cats =
      await withTimeout(
        "CATEGORIES QUERY",
        db
          .select()
          .from(categories)
          .orderBy(
            asc(
              categories.sortOrder,
            ),
          ),
      );

    console.log(
      "[PublicMenu] Categories count:",
      cats.length,
    );

    // -------------------------------------------------------------------------
    // PRODUCTS
    // -------------------------------------------------------------------------

    const prods =
      await withTimeout(
        "PRODUCTS QUERY",
        db
          .select()
          .from(products)
          .where(
            eq(
              products.active,
              true,
            ),
          )
          .orderBy(
            asc(products.name),
          ),
      );

    console.log(
      "[PublicMenu] Products count:",
      prods.length,
    );

    // -------------------------------------------------------------------------
    // RESPONSE
    // -------------------------------------------------------------------------

    const response = {
      desk: {
        id: desk.id,
        name: desk.name,
        type: desk.type,
      },

      booking: activeBooking
        ? {
            id:
              activeBooking.id,
            customerName:
              activeBooking.customerName,
            checkedInAt:
              activeBooking.checkedInAt,
          }
        : null,

      categories:
        cats.map((c) => ({
          id: c.id,
          name: c.name,
          icon: c.icon,
        })),

      products:
        prods.map((p) => ({
          id: p.id,
          categoryId:
            p.categoryId,
          name: p.name,
          price: p.price,
          icon: p.icon,
          imageUrl:
            p.imageUrl,
        })),
    };

    console.log(
      "[PublicMenu] ===== REQUEST SUCCESS =====",
    );

    return NextResponse.json(
      response,
    );
  } catch (error) {
    console.error(
      "[PublicMenu] ===== REQUEST FAILED =====",
    );

    console.error(
      "[PublicMenu] Error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load menu.",
      },
      { status: 500 },
    );
  }
}