import { NextResponse } from "next/server";

import {
  and,
  eq,
  inArray,
  sum,
} from "drizzle-orm";

import { db } from "@/db";

import {
  customers,
  customerMeetingRoomPackages,
  meetingRoomPackageUsageLedger,
} from "@/db/schema";

import {
  getCurrentUser,
} from "@/lib/auth";

export const dynamic =
  "force-dynamic";

/* ============================================================================
 * HELPERS
 * ========================================================================== */

function normalizePhone(
  value: string,
): string {
  const digits =
    value.replace(
      /\D/g,
      "",
    );

  if (!digits) {
    return "";
  }

  if (
    digits.startsWith(
      "0020",
    )
  ) {
    return `20${digits.slice(4)}`;
  }

  if (
    digits.startsWith(
      "20",
    )
  ) {
    return digits;
  }

  if (
    digits.startsWith(
      "0",
    )
  ) {
    return `20${digits.slice(1)}`;
  }

  return digits;
}

/* ============================================================================
 * GET CUSTOMER MEETING ROOM PACKAGES
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
     * PHONE
     * --------------------------------------------------------------------- */

    const url =
      new URL(req.url);

    const rawPhone =
      url.searchParams
        .get("phone")
        ?.trim() ?? "";

    if (!rawPhone) {
      return NextResponse.json(
        {
          error:
            "Customer phone number is required.",
        },
        {
          status: 400,
        },
      );
    }

    const phoneNormalized =
      normalizePhone(
        rawPhone,
      );

    if (
      phoneNormalized.length <
      8
    ) {
      return NextResponse.json(
        {
          error:
            "Please enter a valid customer phone number.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------------------------
     * CUSTOMER
     * --------------------------------------------------------------------- */

    const [
      customer,
    ] =
      await db
        .select({
          id:
            customers.id,

          name:
            customers.name,

          phone:
            customers.phone,
        })
        .from(
          customers,
        )
        .where(
          eq(
            customers.phoneNormalized,
            phoneNormalized,
          ),
        )
        .limit(1);

    if (!customer) {
      return NextResponse.json({
        ok: true,

        customer:
          null,

        packages: [],
      });
    }

    /* -----------------------------------------------------------------------
     * CUSTOMER PACKAGES
     * --------------------------------------------------------------------- */

    const packageRows =
      await db
        .select({
          id:
            customerMeetingRoomPackages.id,

          customerId:
            customerMeetingRoomPackages.customerId,

          packageId:
            customerMeetingRoomPackages.packageId,

          packageNameSnapshot:
            customerMeetingRoomPackages.packageNameSnapshot,

          totalHoursSnapshot:
            customerMeetingRoomPackages.totalHoursSnapshot,

          discountPercentSnapshot:
            customerMeetingRoomPackages.discountPercentSnapshot,

          priceSnapshot:
            customerMeetingRoomPackages.priceSnapshot,

          purchasedAt:
            customerMeetingRoomPackages.purchasedAt,

          startsAt:
            customerMeetingRoomPackages.startsAt,

          expiresAt:
            customerMeetingRoomPackages.expiresAt,

          status:
            customerMeetingRoomPackages.status,
        })
        .from(
          customerMeetingRoomPackages,
        )
        .where(
          eq(
            customerMeetingRoomPackages.customerId,
            customer.id,
          ),
        );

    if (
      packageRows.length ===
      0
    ) {
      return NextResponse.json({
        ok: true,

        customer: {
          id:
            customer.id,

          name:
            customer.name,

          phone:
            customer.phone,
        },

        packages: [],
      });
    }

    /* -----------------------------------------------------------------------
     * LOAD ALL LEDGER BALANCES IN ONE QUERY
     *
     * Instead of:
     *
     *   package 1 -> query
     *   package 2 -> query
     *   package 3 -> query
     *
     * we load the complete ledger aggregate once.
     *
     * SUM(hours_delta) is the source of truth.
     * --------------------------------------------------------------------- */

    const packageIds =
      packageRows.map(
        (pkg) => pkg.id,
      );

    const ledgerBalances =
      await db
        .select({
          packagePurchaseId:
            meetingRoomPackageUsageLedger.packagePurchaseId,

          balance:
            sum(
              meetingRoomPackageUsageLedger.hoursDelta,
            ),
        })
        .from(
          meetingRoomPackageUsageLedger,
        )
        .where(
          inArray(
            meetingRoomPackageUsageLedger.packagePurchaseId,
            packageIds,
          ),
        )
        .groupBy(
          meetingRoomPackageUsageLedger.packagePurchaseId,
        );

    /* -----------------------------------------------------------------------
     * BALANCE MAP
     * --------------------------------------------------------------------- */

    const balanceByPackageId =
      new Map<
        number,
        number
      >();

    for (
      const row of ledgerBalances
    ) {
      const balance =
        Number(
          row.balance ?? 0,
        );

      balanceByPackageId.set(
        row.packagePurchaseId,
        Number.isFinite(
          balance,
        )
          ? balance
          : 0,
      );
    }

    /* -----------------------------------------------------------------------
     * BUILD RESPONSE
     * --------------------------------------------------------------------- */

    const now =
      Date.now();

    const packages =
      packageRows.map(
        (pkg) => {
          const ledgerBalance =
            balanceByPackageId.get(
              pkg.id,
            ) ?? 0;

          const roundedBalance =
            Math.round(
              ledgerBalance * 100,
            ) / 100;

          /*
           * Never expose a negative balance to the UI.
           *
           * A negative balance means the accounting data is inconsistent.
           * The reservation endpoint remains responsible for refusing an
           * invalid/insufficient package.
           */
          const safeRemainingHours =
            Math.max(
              0,
              roundedBalance,
            );

          /* ---------------------------------------------------------------
           * EFFECTIVE STATUS
           * ------------------------------------------------------------- */

          let effectiveStatus =
            pkg.status;

          /*
           * Expiration is derived from the actual expiration timestamp.
           * We intentionally do not write back to the database here.
           *
           * The booking flow remains responsible for final validation.
           */
          if (
            effectiveStatus ===
              "active" &&
            pkg.expiresAt &&
            pkg.expiresAt.getTime() <=
              now
          ) {
            effectiveStatus =
              "expired";
          }

          /*
           * If no usable hours remain, expose exhausted status.
           */
          if (
            effectiveStatus ===
              "active" &&
            safeRemainingHours <=
              0
          ) {
            effectiveStatus =
              "exhausted";
          }

          return {
            id:
              pkg.id,

            customerId:
              pkg.customerId,

            packageId:
              pkg.packageId,

            packageNameSnapshot:
              pkg.packageNameSnapshot,

            totalHoursSnapshot:
              pkg.totalHoursSnapshot,

            discountPercentSnapshot:
              pkg.discountPercentSnapshot,

            priceSnapshot:
              pkg.priceSnapshot,

            purchasedAt:
              pkg.purchasedAt.toISOString(),

            startsAt:
              pkg.startsAt.toISOString(),

            expiresAt:
              pkg.expiresAt
                ? pkg.expiresAt.toISOString()
                : null,

            status:
              effectiveStatus,

            remainingHours:
              safeRemainingHours.toFixed(
                2,
              ),
          };
        },
      );

    /* -----------------------------------------------------------------------
     * RESPONSE
     * --------------------------------------------------------------------- */

    return NextResponse.json({
      ok: true,

      customer: {
        id:
          customer.id,

        name:
          customer.name,

        phone:
          customer.phone,
      },

      packages,
    });
  } catch (error) {
    console.error(
      "Get customer meeting room packages error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load customer meeting room packages.",
      },
      {
        status: 500,
      },
    );
  }
}