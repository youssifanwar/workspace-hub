import { NextResponse } from "next/server";

import {
  and,
  desc,
  eq,
  sql,
} from "drizzle-orm";

import { db } from "@/db";

import {
  bookings,
  customerSubscriptions,
  customers,
  subscriptionUsageLedger,
} from "@/db/schema";

import { getCurrentUser } from "@/lib/auth";

export const dynamic =
  "force-dynamic";

/* -------------------------------------------------------------------------- */
/* PHONE NORMALIZATION                                                        */
/* -------------------------------------------------------------------------- */

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
    return `20${digits.slice(
      4,
    )}`;
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
    return `20${digits.slice(
      1,
    )}`;
  }

  return digits;
}

/* -------------------------------------------------------------------------- */
/* DATE SERIALIZATION                                                         */
/* -------------------------------------------------------------------------- */

function toIso(
  value:
    | Date
    | null
    | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(
          value,
        );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  return date.toISOString();
}

/* -------------------------------------------------------------------------- */
/* SAFE NUMBER                                                                */
/* -------------------------------------------------------------------------- */

function toSafeNumber(
  value: unknown,
): number {
  const number =
    Number(
      value ?? 0,
    );

  if (
    !Number.isFinite(
      number,
    )
  ) {
    return 0;
  }

  return number;
}

/* -------------------------------------------------------------------------- */
/* GET CUSTOMER BY PHONE                                                      */
/* -------------------------------------------------------------------------- */

export async function GET(
  req: Request,
) {
  try {
    /* ---------------------------------------------------------------------- */
    /* AUTH                                                                   */
    /* ---------------------------------------------------------------------- */

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

    /* ---------------------------------------------------------------------- */
    /* READ PHONE                                                             */
    /* ---------------------------------------------------------------------- */

    const url =
      new URL(
        req.url,
      );

    const phone =
      url.searchParams
        .get(
          "phone",
        )
        ?.trim() ?? "";

    if (!phone) {
      return NextResponse.json({
        found: false,
      });
    }

    const phoneNormalized =
      normalizePhone(
        phone,
      );

    if (
      phoneNormalized.length <
      8
    ) {
      return NextResponse.json({
        found: false,
      });
    }

    if (
      phoneNormalized.length >
      20
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid phone number.",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* CUSTOMER                                                               */
    /* ---------------------------------------------------------------------- */

    const customerRows =
      await db
        .select({
          id:
            customers.id,

          name:
            customers.name,

          phone:
            customers.phone,

          email:
            customers.email,

          notes:
            customers.notes,

          createdAt:
            customers.createdAt,
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

    const customer =
      customerRows[0];

    /* ---------------------------------------------------------------------- */
    /* CUSTOMER NOT FOUND                                                     */
    /* ---------------------------------------------------------------------- */

    if (!customer) {
      return NextResponse.json({
        found: false,
      });
    }

    /* ---------------------------------------------------------------------- */
    /* CUSTOMER STATS                                                         */
    /* ---------------------------------------------------------------------- */

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
                    THEN GREATEST(
                      0,
                      EXTRACT(
                        EPOCH FROM (
                          ${bookings.checkedOutAt}
                          -
                          ${bookings.checkedInAt}
                        )
                      ) / 3600
                    )

                    WHEN ${bookings.checkedInAt} IS NOT NULL
                    THEN GREATEST(
                      0,
                      EXTRACT(
                        EPOCH FROM (
                          NOW()
                          -
                          ${bookings.checkedInAt}
                        )
                      ) / 3600
                    )

                    ELSE 0
                  END
                ),
                0
              )
            `,
        })
        .from(
          bookings,
        )
        .where(
          eq(
            bookings.customerId,
            customer.id,
          ),
        );

    const stats =
      statsRows[0];

    /* ---------------------------------------------------------------------- */
    /* SUBSCRIPTIONS                                                          */
    /* ---------------------------------------------------------------------- */

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

          purchasedAt:
            customerSubscriptions.purchasedAt,

          usedHours:
            sql<string>`
              COALESCE(
                -SUM(
                  CASE
                    WHEN
                      ${subscriptionUsageLedger.hoursDelta}
                      < 0
                    THEN
                      ${subscriptionUsageLedger.hoursDelta}
                    ELSE
                      0
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

          customerSubscriptions.purchasedAt,
        )
        .orderBy(
          desc(
            customerSubscriptions.purchasedAt,
          ),
        );

    /* ---------------------------------------------------------------------- */
    /* NORMALIZE SUBSCRIPTIONS                                                */
    /* ---------------------------------------------------------------------- */

    const now =
      new Date();

    const subscriptions =
      subscriptionsRows.map(
        (
          subscription,
        ) => {
          const ledgerBalance =
            toSafeNumber(
              subscription.balance,
            );

          const usedHours =
            Math.max(
              0,
              toSafeNumber(
                subscription.usedHours,
              ),
            );

          const totalHours =
            Math.max(
              0,
              toSafeNumber(
                subscription.totalHours,
              ),
            );

          const remainingHours =
            Math.max(
              0,
              ledgerBalance,
            );

          let status =
            subscription.status;

          /* ---------------------------------------------------------------- */
          /* DERIVED STATUS                                                    */
          /* ---------------------------------------------------------------- */

          if (
            status ===
            "active"
          ) {
            if (
              subscription.startsAt >
              now
            ) {
              status =
                "active";
            } else if (
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

          /* ---------------------------------------------------------------- */
          /* RESPONSE                                                          */
          /* ---------------------------------------------------------------- */

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
              toSafeNumber(
                subscription.price,
              ).toFixed(
                2,
              ),

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

    /* ---------------------------------------------------------------------- */
    /* RESPONSE                                                               */
    /* ---------------------------------------------------------------------- */

    return NextResponse.json({
      found:
        true,

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
          Math.max(
            0,
            Math.trunc(
              toSafeNumber(
                stats?.visits,
              ),
            ),
          ),

        totalHours:
          Math.max(
            0,
            toSafeNumber(
              stats?.totalHours,
            ),
          ),

        totalSpent:
          Math.max(
            0,
            toSafeNumber(
              stats?.totalSpent,
            ),
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
          "Could not search for customer.",
      },
      {
        status: 500,
      },
    );
  }
}