import { NextResponse } from "next/server";

import {
  and,
  eq,
  gt,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db";

import {
  auditLogs,
  customerSubscriptions,
  customers,
  subscriptionPackages,
  subscriptionUsageLedger,
} from "@/db/schema";

import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export const dynamic =
  "force-dynamic";

type PurchaseBody = {
  packageId?: number | string;
  note?: string | null;
};

class ApiError extends Error {
  status: number;

  constructor(
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function parseId(
  value: unknown,
): number | null {
  const id =
    Number(value);

  if (
    !Number.isSafeInteger(
      id,
    ) ||
    id <= 0
  ) {
    return null;
  }

  return id;
}

function cleanOptionalNote(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value !==
    "string"
  ) {
    throw new ApiError(
      "Invalid note.",
      400,
    );
  }

  const note =
    value.trim();

  if (
    note.length >
    2000
  ) {
    throw new ApiError(
      "Note is too long.",
      400,
    );
  }

  return note ||
    null;
}

/* -------------------------------------------------------------------------- */
/* GET ACTIVE SUBSCRIPTION                                                    */
/* -------------------------------------------------------------------------- */

export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
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
    /* CUSTOMER ID                                                            */
    /* ---------------------------------------------------------------------- */

    const {
      id: rawId,
    } = await params;

    const customerId =
      parseId(rawId);

    if (!customerId) {
      return NextResponse.json(
        {
          error:
            "Invalid customer ID.",
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
        })
        .from(
          customers,
        )
        .where(
          eq(
            customers.id,
            customerId,
          ),
        )
        .limit(1);

    const customer =
      customerRows[0];

    if (!customer) {
      return NextResponse.json(
        {
          error:
            "Customer not found.",
        },
        {
          status: 404,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* FIND CURRENT VALID SUBSCRIPTION                                        */
    /* ---------------------------------------------------------------------- */

    const now =
      new Date();

    const subscriptionRows =
      await db
        .select({
          id:
            customerSubscriptions.id,

          packageId:
            customerSubscriptions.packageId,

          packageName:
            customerSubscriptions.packageNameSnapshot,

          totalHours:
            customerSubscriptions.totalHoursSnapshot,

          price:
            customerSubscriptions.priceSnapshot,

          validityDays:
            customerSubscriptions.validityDaysSnapshot,

          purchasedAt:
            customerSubscriptions.purchasedAt,

          startsAt:
            customerSubscriptions.startsAt,

          expiresAt:
            customerSubscriptions.expiresAt,

          status:
            customerSubscriptions.status,
        })
        .from(
          customerSubscriptions,
        )
        .where(
          and(
            eq(
              customerSubscriptions.customerId,
              customerId,
            ),

            eq(
              customerSubscriptions.status,
              "active",
            ),

            or(
              sql`${customerSubscriptions.expiresAt} IS NULL`,
              gt(
                customerSubscriptions.expiresAt,
                now,
              ),
            ),
          ),
        )
        .orderBy(
          sql`${customerSubscriptions.purchasedAt} DESC`,
        )
        .limit(1);

    const subscription =
      subscriptionRows[0];

    if (!subscription) {
      return NextResponse.json({
        active: false,
        subscription: null,
      });
    }

    /* ---------------------------------------------------------------------- */
    /* BALANCE FROM LEDGER                                                    */
    /* ---------------------------------------------------------------------- */

    const balanceRows =
      await db
        .select({
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
          subscriptionUsageLedger,
        )
        .where(
          eq(
            subscriptionUsageLedger.subscriptionId,
            subscription.id,
          ),
        );

    const rawBalance =
      Number(
        balanceRows[0]
          ?.balance ?? 0,
      );

    const remainingHours =
      Number.isFinite(
        rawBalance,
      )
        ? Math.max(
            0,
            rawBalance,
          )
        : 0;

    /* ---------------------------------------------------------------------- */
    /* RESPONSE                                                               */
    /* ---------------------------------------------------------------------- */

    return NextResponse.json({
      active: true,

      subscription: {
        id:
          subscription.id,

        packageId:
          subscription.packageId,

        packageName:
          subscription.packageName,

        totalHours:
          Number(
            subscription.totalHours,
          ),

        price:
          Number(
            subscription.price,
          ),

        validityDays:
          subscription.validityDays,

        purchasedAt:
          subscription.purchasedAt.toISOString(),

        startsAt:
          subscription.startsAt.toISOString(),

        expiresAt:
          subscription.expiresAt
            ? subscription.expiresAt.toISOString()
            : null,

        status:
          subscription.status,

        remainingHours,
      },
    });
  } catch (error) {
    console.error(
      "Get customer subscription error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Could not load customer subscription.",
      },
      {
        status: 500,
      },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* PURCHASE SUBSCRIPTION                                                       */
/* -------------------------------------------------------------------------- */

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
    /* ACTIVE SHIFT                                                           */
    /* ---------------------------------------------------------------------- */

    const shift =
      await getActiveShiftForUser(
        user.id,
      );

    if (!shift) {
      throw new ApiError(
        "No active shift. Open a shift before selling a package.",
        400,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* CUSTOMER ID                                                            */
    /* ---------------------------------------------------------------------- */

    const {
      id: rawId,
    } = await params;

    const customerId =
      parseId(rawId);

    if (!customerId) {
      throw new ApiError(
        "Invalid customer ID.",
        400,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* REQUEST BODY                                                            */
    /* ---------------------------------------------------------------------- */

    const body =
      (await req
        .json()
        .catch(() => null)) as
        | PurchaseBody
        | null;

    if (!body) {
      throw new ApiError(
        "Invalid request.",
        400,
      );
    }

    const packageId =
      parseId(
        String(
          body.packageId ??
            "",
        ),
      );

    if (!packageId) {
      throw new ApiError(
        "A valid package ID is required.",
        400,
      );
    }

    const note =
      cleanOptionalNote(
        body.note,
      );

    /* ---------------------------------------------------------------------- */
    /* TRANSACTION                                                            */
    /* ---------------------------------------------------------------------- */

    const result =
      await db.transaction(
        async (tx) => {
          /* ---------------------------------------------------------------- */
          /* CUSTOMER LOCK                                                     */
          /* ---------------------------------------------------------------- */

          /*
           * Every subscription purchase for the same customer gets
           * serialized by PostgreSQL transaction advisory lock.
           *
           * This prevents two simultaneous requests from both passing
           * the "no active package" check.
           */
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(${customerId})`,
          );

          /* ---------------------------------------------------------------- */
          /* CUSTOMER                                                           */
          /* ---------------------------------------------------------------- */

          const customerRows =
            await tx
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
                  customers.id,
                  customerId,
                ),
              )
              .limit(1);

          const customer =
            customerRows[0];

          if (!customer) {
            throw new ApiError(
              "Customer not found.",
              404,
            );
          }

          /* ---------------------------------------------------------------- */
          /* ACTIVE SUBSCRIPTION CHECK                                        */
          /* ---------------------------------------------------------------- */

          const now =
            new Date();

          const activeRows =
            await tx
              .select({
                id:
                  customerSubscriptions.id,

                packageName:
                  customerSubscriptions.packageNameSnapshot,

                expiresAt:
                  customerSubscriptions.expiresAt,
              })
              .from(
                customerSubscriptions,
              )
              .where(
                and(
                  eq(
                    customerSubscriptions.customerId,
                    customerId,
                  ),

                  eq(
                    customerSubscriptions.status,
                    "active",
                  ),

                  or(
                    sql`${customerSubscriptions.expiresAt} IS NULL`,
                    gt(
                      customerSubscriptions.expiresAt,
                      now,
                    ),
                  ),
                ),
              )
              .orderBy(
                sql`${customerSubscriptions.purchasedAt} DESC`,
              )
              .limit(1);

          const activeSubscription =
            activeRows[0];

          if (
            activeSubscription
          ) {
            throw new ApiError(
              `Customer already has an active package: ${activeSubscription.packageName}.`,
              409,
            );
          }

          /* ---------------------------------------------------------------- */
          /* PACKAGE                                                           */
          /* ---------------------------------------------------------------- */

          const packageRows =
            await tx
              .select({
                id:
                  subscriptionPackages.id,

                name:
                  subscriptionPackages.name,

                totalHours:
                  subscriptionPackages.totalHours,

                price:
                  subscriptionPackages.price,

                validityDays:
                  subscriptionPackages.validityDays,

                active:
                  subscriptionPackages.active,
              })
              .from(
                subscriptionPackages,
              )
              .where(
                eq(
                  subscriptionPackages.id,
                  packageId,
                ),
              )
              .limit(1);

          const pkg =
            packageRows[0];

          if (!pkg) {
            throw new ApiError(
              "Subscription package not found.",
              404,
            );
          }

          if (!pkg.active) {
            throw new ApiError(
              "This package is not available for new purchases.",
              400,
            );
          }

          /* ---------------------------------------------------------------- */
          /* PACKAGE VALUES VALIDATION                                       */
          /* ---------------------------------------------------------------- */

          const totalHours =
            Number(
              pkg.totalHours,
            );

          const price =
            Number(
              pkg.price,
            );

          if (
            !Number.isFinite(
              totalHours,
            ) ||
            totalHours <=
              0
          ) {
            throw new ApiError(
              "Subscription package has an invalid number of hours.",
              500,
            );
          }

          if (
            !Number.isFinite(
              price,
            ) ||
            price < 0
          ) {
            throw new ApiError(
              "Subscription package has an invalid price.",
              500,
            );
          }

          /* ---------------------------------------------------------------- */
          /* EXPIRATION                                                        */
          /* ---------------------------------------------------------------- */

          const expiresAt =
            pkg.validityDays !==
              null &&
            pkg.validityDays !==
              undefined
              ? new Date(
                  now.getTime() +
                    pkg.validityDays *
                      24 *
                      60 *
                      60 *
                      1000,
                )
              : null;

          /* ---------------------------------------------------------------- */
          /* CREATE SUBSCRIPTION                                              */
          /* ---------------------------------------------------------------- */

          const inserted =
            await tx
              .insert(
                customerSubscriptions,
              )
              .values({
                customerId:
                  customer.id,

                packageId:
                  pkg.id,

                packageNameSnapshot:
                  pkg.name,

                totalHoursSnapshot:
                  totalHours.toFixed(
                    2,
                  ),

                priceSnapshot:
                  price.toFixed(
                    2,
                  ),

                validityDaysSnapshot:
                  pkg.validityDays,

                purchasedAt:
                  now,

                startsAt:
                  now,

                expiresAt,

                status:
                  "active",

                note,

                createdByUserId:
                  user.id,
              })
              .returning({
                id:
                  customerSubscriptions.id,
              });

          const subscription =
            inserted[0];

          if (!subscription) {
            throw new ApiError(
              "Could not create customer subscription.",
              500,
            );
          }

          /* ---------------------------------------------------------------- */
          /* INITIAL LEDGER CREDIT                                            */
          /* ---------------------------------------------------------------- */

          await tx
            .insert(
              subscriptionUsageLedger,
            )
            .values({
              subscriptionId:
                subscription.id,

              bookingId:
                null,

              userId:
                user.id,

              entryType:
                "purchase",

              hoursDelta:
                totalHours.toFixed(
                  2,
                ),

              reason:
                `Purchased package "${pkg.name}"`,

              idempotencyKey:
                `subscription_purchase_${subscription.id}`,
            });

          /* ---------------------------------------------------------------- */
          /* AUDIT                                                            */
          /* ---------------------------------------------------------------- */

          await tx
            .insert(
              auditLogs,
            )
            .values({
              userId:
                user.id,

              action:
                "subscription_purchased",

              entityType:
                "customer_subscription",

              entityId:
                subscription.id,

              details: {
                customerId:
                  customer.id,

                customerName:
                  customer.name,

                packageId:
                  pkg.id,

                packageName:
                  pkg.name,

                totalHours,

                price,

                validityDays:
                  pkg.validityDays,

                expiresAt:
                  expiresAt
                    ? expiresAt.toISOString()
                    : null,

                shiftId:
                  shift.id,
              },
            });

          /* ---------------------------------------------------------------- */
          /* RESULT                                                           */
          /* ---------------------------------------------------------------- */

          return {
            subscriptionId:
              subscription.id,

            customerId:
              customer.id,

            customerName:
              customer.name,

            packageId:
              pkg.id,

            packageName:
              pkg.name,

            totalHours,

            price,

            validityDays:
              pkg.validityDays,

            startsAt:
              now,

            expiresAt,
          };
        },
      );

    /* ---------------------------------------------------------------------- */
    /* RESPONSE                                                               */
    /* ---------------------------------------------------------------------- */

    return NextResponse.json(
      {
        ok: true,

        subscription: {
          id:
            result.subscriptionId,

          customerId:
            result.customerId,

          customerName:
            result.customerName,

          packageId:
            result.packageId,

          packageName:
            result.packageName,

          totalHours:
            result.totalHours,

          remainingHours:
            result.totalHours,

          price:
            result.price,

          validityDays:
            result.validityDays,

          status:
            "active",

          startsAt:
            result.startsAt.toISOString(),

          expiresAt:
            result.expiresAt
              ? result.expiresAt.toISOString()
              : null,
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error(
      "Purchase customer subscription error:",
      error,
    );

    if (
      error instanceof
      ApiError
    ) {
      return NextResponse.json(
        {
          error:
            error.message,
        },
        {
          status:
            error.status,
        },
      );
    }

    return NextResponse.json(
      {
        error:
          "Could not purchase subscription.",
      },
      {
        status: 500,
      },
    );
  }
}