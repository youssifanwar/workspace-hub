import { NextResponse } from "next/server";

import {
  and,
  eq,
  inArray,
  sql,
  sum,
} from "drizzle-orm";

import { db } from "@/db";

import {
  auditLogs,
  customers,
  customerMeetingRoomPackages,
  meetingRoomPackages,
  meetingRoomPackageUsageLedger,
} from "@/db/schema";

import { getActiveShiftForUser } from "@/lib/shift";

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

/* ============================================================================
 * SELL A MEETING ROOM PACKAGE TO A CUSTOMER
 * ========================================================================== */

class SaleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const shift = await getActiveShiftForUser(user.id);
    if (!shift) {
      throw new SaleError(
        "No active shift. Open a shift before selling a package.",
      );
    }

    const body = (await req.json().catch(() => null)) as {
      customerId?: unknown;
      packageId?: unknown;
      purchasedAt?: unknown;
      note?: unknown;
    } | null;
    if (!body) throw new SaleError("Invalid request.");

    const customerId = Number(body.customerId);
    const packageId = Number(body.packageId);
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      throw new SaleError("A valid customer is required.");
    }
    if (!Number.isSafeInteger(packageId) || packageId <= 0) {
      throw new SaleError("A valid package is required.");
    }

    // Payment date: defaults to now, cannot be in the future.
    const now = new Date();
    let paymentDate = now;
    if (
      body.purchasedAt !== undefined &&
      body.purchasedAt !== null &&
      body.purchasedAt !== ""
    ) {
      const parsed = new Date(String(body.purchasedAt));
      if (Number.isNaN(parsed.getTime())) {
        throw new SaleError("Invalid payment date.");
      }
      if (parsed.getTime() > now.getTime() + 5 * 60 * 1000) {
        throw new SaleError("Payment date cannot be in the future.");
      }
      if (parsed.getTime() < now.getTime() - 366 * 24 * 60 * 60 * 1000) {
        throw new SaleError("Payment date is more than a year ago.");
      }
      paymentDate = parsed;
    }

    const note =
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, 1000)
        : null;

    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`mr-package-customer-${customerId}`}))`,
      );

      const [customer] = await tx
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
      if (!customer) throw new SaleError("Customer not found.", 404);

      const [pkg] = await tx
        .select()
        .from(meetingRoomPackages)
        .where(eq(meetingRoomPackages.id, packageId))
        .limit(1);
      if (!pkg) throw new SaleError("Package not found.", 404);
      if (pkg.status !== "active") {
        throw new SaleError("This package is not available for sale.");
      }

      const totalHours = Number(pkg.totalHours);
      const price = Number(pkg.price);
      if (!Number.isFinite(totalHours) || totalHours <= 0) {
        throw new SaleError("Package has an invalid number of hours.", 500);
      }
      if (!Number.isFinite(price) || price < 0) {
        throw new SaleError("Package has an invalid price.", 500);
      }

      const expiresAt =
        pkg.validityDays && pkg.validityDays > 0
          ? new Date(
              paymentDate.getTime() +
                pkg.validityDays * 24 * 60 * 60 * 1000,
            )
          : null;

      const [purchase] = await tx
        .insert(customerMeetingRoomPackages)
        .values({
          customerId: customer.id,
          packageId: pkg.id,
          packageNameSnapshot: pkg.name,
          totalHoursSnapshot: totalHours.toFixed(2),
          discountPercentSnapshot: Number(pkg.discountPercent).toFixed(2),
          priceSnapshot: price.toFixed(2),
          validityDaysSnapshot: pkg.validityDays,
          purchasedAt: paymentDate,
          startsAt: paymentDate,
          expiresAt,
          status: "active",
          note,
          createdByUserId: user.id,
        })
        .returning({ id: customerMeetingRoomPackages.id });
      if (!purchase) throw new SaleError("Could not create purchase.", 500);

      await tx.insert(meetingRoomPackageUsageLedger).values({
        packagePurchaseId: purchase.id,
        reservationId: null,
        userId: user.id,
        entryType: "purchase",
        hoursDelta: totalHours.toFixed(2),
        reason: `Purchased package "${pkg.name}"`,
        idempotencyKey: `meeting_room_package_purchase_${purchase.id}`,
      });

      await tx.insert(auditLogs).values({
        userId: user.id,
        action: "meeting_room_package_sold",
        entityType: "customer",
        entityId: customer.id,
        details: {
          purchaseId: purchase.id,
          packageId: pkg.id,
          packageName: pkg.name,
          totalHours,
          price,
          paymentDate: paymentDate.toISOString(),
          shiftId: shift.id,
        },
      });

      return {
        id: purchase.id,
        customer,
        packageName: pkg.name,
        totalHours,
        price,
        purchasedAt: paymentDate.toISOString(),
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      };
    });

    return NextResponse.json({ ok: true, purchase: result }, { status: 201 });
  } catch (error) {
    if (error instanceof SaleError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("Sell meeting room package error:", error);
    return NextResponse.json(
      { error: "Could not sell the package." },
      { status: 500 },
    );
  }
}
