import { NextResponse } from "next/server";

import { db } from "@/db";

import {
  bookings,
  bookingItems,
} from "@/db/schema";

import { eq } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";

import { getActiveShiftForUser } from "@/lib/shift";

/**
 * SESSION PRICING
 *
 * 1st started hour = 40 EGP
 * 2nd started hour = +30 EGP
 * 3rd started hour = +30 EGP
 * 4th started hour = +30 EGP
 *
 * Once the session goes beyond 4 started hours,
 * it becomes a Day Pass for 150 EGP.
 *
 * Examples:
 *
 * 00:01 -> 40
 * 00:59 -> 40
 *
 * 01:01 -> 70
 * 01:59 -> 70
 *
 * 02:01 -> 100
 * 02:59 -> 100
 *
 * 03:01 -> 130
 * 03:59 -> 130
 *
 * 04:00 -> 130
 *
 * 04:01 -> 150 Day Pass
 * 05:00 -> 150 Day Pass
 * 08:00 -> 150 Day Pass
 */

const FIRST_HOUR_PRICE = 40;
const EXTRA_HOUR_PRICE = 30;
const DAY_PASS_PRICE = 150;

function calculateSessionPrice(
  billableHours: number,
) {
  // First hour
  if (billableHours <= 1) {
    return {
      seatCharge: FIRST_HOUR_PRICE,
      pricingType: "hour",
    } as const;
  }

  // Second hour
  if (billableHours === 2) {
    return {
      seatCharge:
        FIRST_HOUR_PRICE +
        EXTRA_HOUR_PRICE,
      pricingType: "hour",
    } as const;
  }

  // Third hour
  if (billableHours === 3) {
    return {
      seatCharge:
        FIRST_HOUR_PRICE +
        EXTRA_HOUR_PRICE * 2,
      pricingType: "hour",
    } as const;
  }

  // Fourth hour
  if (billableHours === 4) {
    return {
      seatCharge:
        FIRST_HOUR_PRICE +
        EXTRA_HOUR_PRICE * 3,
      pricingType: "hour",
    } as const;
  }

  // Anything beyond 4 started hours
  // becomes the Day Pass.
  return {
    seatCharge: DAY_PASS_PRICE,
    pricingType: "day",
  } as const;
}

export async function POST(
  req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const { id } = await params;

    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    const shift =
      await getActiveShiftForUser(
        user.id,
      );

    if (!shift) {
      return NextResponse.json(
        {
          error: "No active shift",
        },
        {
          status: 400,
        },
      );
    }

    const bookingId = Number(id);

    if (
      !Number.isInteger(
        bookingId,
      ) ||
      bookingId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid booking id",
        },
        {
          status: 400,
        },
      );
    }

    const body =
      (await req.json()) as {
        paymentMethod?:
          | "cash"
          | "visa"
          | "instapay";

        paidAmount?: number;

        discount?: number;
      };

    if (!body.paymentMethod) {
      return NextResponse.json(
        {
          error:
            "paymentMethod required",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* LOAD SESSION                                                            */
    /* ---------------------------------------------------------------------- */

    const [booking] =
      await db
        .select()
        .from(bookings)
        .where(
          eq(
            bookings.id,
            bookingId,
          ),
        )
        .limit(1);

    if (!booking) {
      return NextResponse.json(
        {
          error:
            "Session not found",
        },
        {
          status: 404,
        },
      );
    }

    if (
      booking.status ===
      "closed"
    ) {
      return NextResponse.json(
        {
          error:
            "Session already closed",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* F&B                                                                     */
    /* ---------------------------------------------------------------------- */

    const items =
      await db
        .select()
        .from(bookingItems)
        .where(
          eq(
            bookingItems.bookingId,
            bookingId,
          ),
        );

    const ordersTotal =
      items.reduce(
        (
          sum,
          item,
        ) => {
          return (
            sum +
            item.quantity *
              parseFloat(
                item.unitPrice,
              )
          );
        },
        0,
      );

    /* ---------------------------------------------------------------------- */
    /* TIME                                                                     */
    /* ---------------------------------------------------------------------- */

    const closedAt =
      new Date();

    const checkedInAt =
      new Date(
        booking.checkedInAt,
      );

    const elapsedMs =
      Math.max(
        0,
        closedAt.getTime() -
          checkedInAt.getTime(),
      );

    const elapsedHours =
      elapsedMs /
      3_600_000;

    /*
     * Every started hour is billed
     * as a complete hour.
     *
     * 00:01 -> 1
     * 01:01 -> 2
     * 02:01 -> 3
     * 03:01 -> 4
     * 04:01 -> 5 -> Day Pass
     */
    const billableHours =
      Math.max(
        1,
        Math.ceil(
          elapsedHours,
        ),
      );

    /* ---------------------------------------------------------------------- */
    /* PRICING                                                                 */
    /* ---------------------------------------------------------------------- */

    const pricing =
      calculateSessionPrice(
        billableHours,
      );

    const seatCharge =
      pricing.seatCharge;

    /* ---------------------------------------------------------------------- */
    /* DISCOUNT                                                                 */
    /* ---------------------------------------------------------------------- */

    const discount =
      Math.max(
        0,
        Number(
          body.discount || 0,
        ),
      );

    const total =
      Math.max(
        0,
        seatCharge +
          ordersTotal -
          discount,
      );

    /* ---------------------------------------------------------------------- */
    /* PAYMENT                                                                  */
    /* ---------------------------------------------------------------------- */

    const paid =
      Math.max(
        0,
        Number(
          body.paidAmount || 0,
        ),
      );

    const change =
      body.paymentMethod ===
      "cash"
        ? Math.max(
            0,
            paid - total,
          )
        : 0;

    if (
      body.paymentMethod ===
        "cash" &&
      paid < total
    ) {
      return NextResponse.json(
        {
          error:
            "Insufficient cash paid",

          total,

          paid,

          billableHours,

          pricingType:
            pricing.pricingType,
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* CLOSE SESSION                                                            */
    /* ---------------------------------------------------------------------- */

    await db
      .update(bookings)
      .set({
        checkedOutAt:
          closedAt,

        seatCharge:
          seatCharge.toFixed(2),

        ordersTotal:
          ordersTotal.toFixed(2),

        discount:
          discount.toFixed(2),

        total:
          total.toFixed(2),

        paidAmount:
          paid.toFixed(2),

        changeAmount:
          change.toFixed(2),

        paymentMethod:
          body.paymentMethod,

        status: "closed",
      })
      .where(
        eq(
          bookings.id,
          bookingId,
        ),
      );

    /* ---------------------------------------------------------------------- */
    /* RESPONSE                                                                 */
    /* ---------------------------------------------------------------------- */

    return NextResponse.json({
      ok: true,

      sessionId: bookingId,

      elapsedHours,

      billableHours,

      pricingType:
        pricing.pricingType,

      firstHourPrice:
        FIRST_HOUR_PRICE,

      extraHourPrice:
        EXTRA_HOUR_PRICE,

      dayPassPrice:
        DAY_PASS_PRICE,

      seatCharge,

      ordersTotal,

      discount,

      total,

      paid,

      change,
    });
  } catch (error) {
    console.error(
      "[checkout] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Checkout failed. Please try again.",
      },
      {
        status: 500,
      },
    );
  }
}