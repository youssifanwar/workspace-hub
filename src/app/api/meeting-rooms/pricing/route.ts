import { NextResponse } from "next/server";

import {
  calculateMeetingRoomBooking,
  calculateMeetingRoomBookingWithPackage,
} from "@/lib/meeting-room-billing";

import {
  getCurrentUser,
} from "@/lib/auth";

export const dynamic =
  "force-dynamic";

/* ============================================================================
 * HELPERS
 * ========================================================================== */

function parsePositiveSafeInteger(
  value: string | null,
): number | null {
  if (!value) {
    return null;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(
      parsed,
    ) ||
    parsed <= 0
  ) {
    return null;
  }

  return parsed;
}

function parsePositiveNumber(
  value: string | null,
): number | null {
  if (!value) {
    return null;
  }

  const parsed =
    Number(value);

  if (
    !Number.isFinite(
      parsed,
    ) ||
    parsed <= 0
  ) {
    return null;
  }

  return parsed;
}

/* ============================================================================
 * GET PRICE
 * ========================================================================== */

export async function GET(
  req: Request,
) {
  try {
    /* -----------------------------------------------------------------------
     * AUTH
     * --------------------------------------------------------------------- */

    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    /* -----------------------------------------------------------------------
     * QUERY
     * --------------------------------------------------------------------- */

    const url =
      new URL(req.url);

    const deskId =
      parsePositiveSafeInteger(
        url.searchParams.get(
          "deskId",
        ),
      );

    const attendeeCount =
      parsePositiveSafeInteger(
        url.searchParams.get(
          "attendeeCount",
        ),
      );

    const durationHours =
      parsePositiveNumber(
        url.searchParams.get(
          "durationHours",
        ),
      );

    const packagePurchaseId =
      parsePositiveSafeInteger(
        url.searchParams.get(
          "packagePurchaseId",
        ),
      );

    /* -----------------------------------------------------------------------
     * REQUIRED INPUT
     * --------------------------------------------------------------------- */

    if (!deskId) {
      return NextResponse.json(
        {
          error:
            "A valid meeting room is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (!attendeeCount) {
      return NextResponse.json(
        {
          error:
            "Attendee count is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !durationHours
    ) {
      return NextResponse.json(
        {
          error:
            "Duration is required.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------------------------
     * WHOLE HOUR VALIDATION
     *
     * Meeting rooms support whole-hour reservations only.
     * 1.5h / 2.5h / etc. are rejected here before billing.
     * The billing engine remains the final authority.
     * --------------------------------------------------------------------- */

    if (
      !Number.isInteger(
        durationHours,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Meeting room duration must be a whole number of hours. 1:30 bookings are not allowed.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      durationHours <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Duration must be greater than zero.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------------------------
     * PACKAGE BILLING
     * --------------------------------------------------------------------- */

    if (
      packagePurchaseId !== null
    ) {
      try {
        const result =
          await calculateMeetingRoomBookingWithPackage(
            {
              deskId,

              attendeeCount,

              durationHours,

              packagePurchaseId,
            },
          );

        return NextResponse.json({
          ok: true,

          billingMode:
            "package",

          deskId:
            result.deskId,

          attendeeCount:
            result.attendeeCount,

          durationHours:
            result.durationHours,

          pricingTier: {
            minPeople:
              result.minPeople,

            maxPeople:
              result.maxPeople,
          },

          hourlyRate:
            result.hourlyRate,

          subtotalAmount:
            result.subtotalAmount,

          discountPercent:
            result.packageDiscountPercent,

          discountAmount:
            result.packageDiscountAmount,

          totalAmount:
            result.totalAmount,

          packagePurchaseId:
            result.packagePurchaseId,

          packageHoursUsed:
            result.packageHoursUsed,

          packageRemainingHours:
            result.packageRemainingHours,
        });
      } catch (error) {
        console.error(
          "Meeting room package pricing error:",
          error,
        );

        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Could not calculate package price.",
          },
          {
            status: 400,
          },
        );
      }
    }

    /* -----------------------------------------------------------------------
     * REGULAR BILLING
     * --------------------------------------------------------------------- */

    try {
      const result =
        await calculateMeetingRoomBooking(
          {
            deskId,

            attendeeCount,

            durationHours,
          },
        );

      return NextResponse.json({
        ok: true,

        billingMode:
          "regular",

        deskId:
          result.deskId,

        attendeeCount:
          result.attendeeCount,

        durationHours:
          result.durationHours,

        pricingTier: {
          minPeople:
            result.minPeople,

          maxPeople:
            result.maxPeople,
        },

        hourlyRate:
          result.hourlyRate,

        subtotalAmount:
          result.subtotalAmount,

        discountPercent:
          result.packageDiscountPercent,

        discountAmount:
          result.packageDiscountAmount,

        totalAmount:
          result.totalAmount,

        packagePurchaseId:
          null,

        packageHoursUsed:
          "0.00",

        packageRemainingHours:
          null,
      });
    } catch (error) {
      console.error(
        "Meeting room regular pricing error:",
        error,
      );

      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not calculate meeting room price.",
        },
        {
          status: 400,
        },
      );
    }
  } catch (error) {
    console.error(
      "Meeting room pricing error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not calculate meeting room price.",
      },
      {
        status: 500,
      },
    );
  }
}