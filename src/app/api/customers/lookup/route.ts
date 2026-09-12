import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  bookings,
  customerSubscriptions,
  customers,
  subscriptionUsageLedger,
} from "@/db/schema";

import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ============================================================================
// PHONE NORMALIZATION
// ============================================================================

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

  // 0020XXXXXXXXXX -> 20XXXXXXXXXX
  if (
    digits.startsWith(
      "0020",
    )
  ) {
    return `20${digits.slice(
      4,
    )}`;
  }

  // 20XXXXXXXXXX -> already normalized
  if (
    digits.startsWith("20")
  ) {
    return digits;
  }

  // 0XXXXXXXXXX -> 20XXXXXXXXXX
  if (
    digits.startsWith("0")
  ) {
    return `20${digits.slice(
      1,
    )}`;
  }

  return digits;
}

// ============================================================================
// DATE SERIALIZATION
// ============================================================================

function toIso(
  value: Date | null | undefined,
) {
  return value
    ? value.toISOString()
    : null;
}

// ============================================================================
// GET CUSTOMER BY PHONE
// ============================================================================

export async function GET(
  req: Request,
) {
  try {
    // ------------------------------------------------------------------------
    // AUTH
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // READ PHONE
    // ------------------------------------------------------------------------

    const url =
      new URL(req.url);

    const phone =
      url.searchParams.get(
        "phone",
      )?.trim() || "";

    const phoneNormalized =
      normalizePhone(phone);

    if (
      phoneNormalized.length <
      8
    ) {
      return NextResponse.json(
        {
          found: false,
        },
        {
          status: 200,
        },
      );
    }

    // ------------------------------------------------------------------------
    // CUSTOMER
    // ------------------------------------------------------------------------

    const customerRows =
      await db
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
          email: customers.email,
          notes: customers.notes,
          createdAt:
            customers.createdAt,
        })
        .from(customers)
        .where(
          eq(
            customers.phoneNormalized,
            phoneNormalized,
          ),
        )
        .limit(1);

    const customer =
      customerRows[0];

    // ------------------------------------------------------------------------
    // CUSTOMER NOT FOUND
    // ------------------------------------------------------------------------

    if (!customer) {
      return NextResponse.json(
        {
          found: false,
        },
        {
          status: 200,
        },
      );
    }

    // ------------------------------------------------------------------------
    // CUSTOMER STATS
    //
    // Visits = all sessions for this customer.
    // Hours = actual session duration where possible.
    // Spent = closed-session totals.
    // ------------------------------------------------------------------------

    const statsRows =
      await db
        .select({
          visits:
            sql<number>`
              COUNT(
                ${bookings.id}
              )
            `,

          totalSpent:
            sql<string>`
              COALESCE(
                SUM(
                  CASE
                    WHEN ${bookings.status} = 'closed'
                    THEN COALESCE(
                      ${bookings.total},
                      0
                    )
                    ELSE 0
                  END
                ),
                0
              )
            `,

          totalHours:
            sql<string>`
              COALESCE(
                SUM(
                  CASE
                    WHEN ${bookings.checkedOutAt} IS NOT NULL
                    THEN EXTRACT(
                      EPOCH FROM (
                        ${bookings.checkedOutAt} -
                        ${bookings.checkedInAt}
                      )
                    ) / 3600
                    ELSE EXTRACT(
                      EPOCH FROM (
                        NOW() -
                        ${bookings.checkedInAt}
                      )
                    ) / 3600
                  END
                ),
                0
              )
            `,
        })
        .from(bookings)
        .where(
          eq(
            bookings.customerId,
            customer.id,
          ),
        );

    const stats =
      statsRows[0];

    // ------------------------------------------------------------------------
    // ACTIVE SUBSCRIPTIONS
    // ------------------------------------------------------------------------
    //
    // IMPORTANT:
    // We calculate remaining hours from the ledger instead of trusting a
    // manually updated "remaining" number.
    // ------------------------------------------------------------------------

    const subscriptionsRows =
      await db
        .select({
          id:
            customerSubscriptions.id,

          packageName:
            customerSubscriptions.packageNameSnapshot,

          totalHours:
            customerSubscriptions.totalHoursSnapshot,

          price:
            customerSubscriptions.priceSnapshot,

          startsAt:
            customerSubscriptions.startsAt,

          expiresAt:
            customerSubscriptions.expiresAt,

          status:
            customerSubscriptions.status,

          usedHours:
            sql<string>`
              COALESCE(
                -SUM(
                  CASE
                    WHEN ${subscriptionUsageLedger.hoursDelta} < 0
                    THEN ${subscriptionUsageLedger.hoursDelta}
                    ELSE 0
                  END
                ),
                0
              )
            `,

          balance:
            sql<string>`
              COALESCE(
                SUM(
                  ${subscriptionUsageLedger.hoursDelta}
                ),
                0
              )
            `,
        })
        .from(
          customerSubscriptions,
        )
        .leftJoin(
          subscriptionUsageLedger,
          eq(
            subscriptionUsageLedger.subscriptionId,
            customerSubscriptions.id,
          ),
        )
        .where(
          eq(
            customerSubscriptions.customerId,
            customer.id,
          ),
        )
        .groupBy(
          customerSubscriptions.id,
          customerSubscriptions.packageNameSnapshot,
          customerSubscriptions.totalHoursSnapshot,
          customerSubscriptions.priceSnapshot,
          customerSubscriptions.startsAt,
          customerSubscriptions.expiresAt,
          customerSubscriptions.status,
        )
        .orderBy(
          desc(
            customerSubscriptions.purchasedAt,
          ),
        );

    // ------------------------------------------------------------------------
    // NORMALIZE SUBSCRIPTIONS
    // ------------------------------------------------------------------------

    const now =
      new Date();

    const subscriptions =
      subscriptionsRows.map(
        (subscription) => {
          const ledgerBalance =
            Number(
              subscription.balance ??
                "0",
            );

          const usedHours =
            Number(
              subscription.usedHours ??
                "0",
            );

          const totalHours =
            Number(
              subscription.totalHours ??
                "0",
            );

          // Never expose a negative remaining balance.
          const remainingHours =
            Math.max(
              0,
              ledgerBalance,
            );

          let status =
            subscription.status;

          // ------------------------------------------------------------------
          // Derived expiration status.
          //
          // We do not mutate the DB here.
          // The actual subscription status can be updated by the subscription
          // management API later.
          // ------------------------------------------------------------------

          if (
            status === "active"
          ) {
            if (
              subscription.expiresAt &&
              subscription.expiresAt <=
                now
            ) {
              status =
                "expired";
            } else if (
              remainingHours <=
              0
            ) {
              status =
                "exhausted";
            }
          }

          return {
            id:
              subscription.id,

            packageName:
              subscription.packageName,

            totalHours:
              totalHours.toFixed(
                2,
              ),

            usedHours:
              usedHours.toFixed(
                2,
              ),

            remainingHours:
              remainingHours.toFixed(
                2,
              ),

            price:
              Number(
                subscription.price ??
                  "0",
              ).toFixed(2),

            startsAt:
              toIso(
                subscription.startsAt,
              ),

            expiresAt:
              toIso(
                subscription.expiresAt,
              ),

            status:
              status as
                | "active"
                | "expired"
                | "exhausted"
                | "cancelled",
          };
        },
      );

    // ------------------------------------------------------------------------
    // RESPONSE
    // ------------------------------------------------------------------------

    return NextResponse.json({
      found: true,

      customer: {
        id:
          customer.id,

        name:
          customer.name,

        phone:
          customer.phone,

        email:
          customer.email,

        notes:
          customer.notes,

        createdAt:
          toIso(
            customer.createdAt,
          ),
      },

      stats: {
        visits:
          Number(
            stats?.visits ??
              0,
          ),

        totalHours:
          Number(
            stats?.totalHours ??
              0,
          ),

        totalSpent:
          Number(
            stats?.totalSpent ??
              0,
          ),
      },

      subscriptions,
    });
  } catch (error) {
    console.error(
      "Customer lookup error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not search for customer.",
      },
      {
        status: 500,
      },
    );
  }
}