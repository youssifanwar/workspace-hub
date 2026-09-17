import { NextResponse } from "next/server";

import { db } from "@/db";

import {
  bookings,
  bookingItems,
  customerSubscriptions,
  subscriptionUsageLedger,
} from "@/db/schema";

import {
  and,
  eq,
  sql,
} from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";

import { getActiveShiftForUser } from "@/lib/shift";

import {
  getCustomerSessionPricing,
} from "@/lib/settings";

/**
 * CUSTOMER SESSION CHECKOUT
 *
 * Pricing is loaded from settings.
 *
 * Regular Customer Session:
 *
 * 1 hour  -> configured 1h price
 * 2 hours -> configured 2h price
 * 3 hours -> configured 3h price
 * 4 hours -> configured 4h price
 * >4 hours -> configured Day Pass price
 *
 * Package Customer Session:
 *
 * Seat time = 0
 * Required hours are deducted from the subscription usage ledger.
 *
 * The database transaction + advisory locks make checkout safe against
 * duplicate/concurrent checkout requests.
 */

function calculateSessionPrice(
  billableHours: number,
  pricing: {
    oneHour: number;
    twoHours: number;
    threeHours: number;
    fourHours: number;
    dayPass: number;
  },
) {
  if (billableHours <= 1) {
    return {
      seatCharge:
        pricing.oneHour,
      pricingType:
        "hour" as const,
    };
  }

  if (billableHours === 2) {
    return {
      seatCharge:
        pricing.twoHours,
      pricingType:
        "hour" as const,
    };
  }

  if (billableHours === 3) {
    return {
      seatCharge:
        pricing.threeHours,
      pricingType:
        "hour" as const,
    };
  }

  if (billableHours === 4) {
    return {
      seatCharge:
        pricing.fourHours,
      pricingType:
        "hour" as const,
    };
  }

  return {
    seatCharge:
      pricing.dayPass,
    pricingType:
      "day" as const,
  };
}

function isFiniteNonNegativeNumber(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  );
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
    const { id } =
      await params;

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

    const shift =
      await getActiveShiftForUser(
        user.id,
      );

    if (!shift) {
      return NextResponse.json(
        {
          error:
            "No active shift",
        },
        {
          status: 400,
        },
      );
    }

    const bookingId =
      Number(id);

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

    let body: {
      paymentMethod?:
        | "cash"
        | "visa"
        | "instapay";

      paidAmount?: number;

      discount?: number;
    };

    try {
      body =
        (await req.json()) as {
          paymentMethod?:
            | "cash"
            | "visa"
            | "instapay";

          paidAmount?: number;

          discount?: number;
        };
    } catch {
      return NextResponse.json(
        {
          error:
            "Invalid JSON body",
        },
        {
          status: 400,
        },
      );
    }

    const paymentMethod =
      body.paymentMethod;

    if (
      paymentMethod !== "cash" &&
      paymentMethod !== "visa" &&
      paymentMethod !== "instapay"
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid payment method",
        },
        {
          status: 400,
        },
      );
    }

    const paid =
      body.paidAmount ??
      0;

    const discount =
      body.discount ??
      0;

    if (
      !isFiniteNonNegativeNumber(
        paid,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid paid amount",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !isFiniteNonNegativeNumber(
        discount,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid discount",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * Load current Customer Session pricing from Settings.
     *
     * This removes the hard-coded 40 / 30 / 150 values.
     */
    const sessionPricing =
      await getCustomerSessionPricing();

    /*
     * Basic sanity check so a broken setting cannot make checkout
     * silently use NaN / Infinity / negative values.
     */
    if (
      !isFiniteNonNegativeNumber(
        sessionPricing.oneHour,
      ) ||
      !isFiniteNonNegativeNumber(
        sessionPricing.twoHours,
      ) ||
      !isFiniteNonNegativeNumber(
        sessionPricing.threeHours,
      ) ||
      !isFiniteNonNegativeNumber(
        sessionPricing.fourHours,
      ) ||
      !isFiniteNonNegativeNumber(
        sessionPricing.dayPass,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid Customer Session pricing configuration",
        },
        {
          status: 500,
        },
      );
    }

    /*
     * Use a transaction + advisory lock for this booking.
     *
     * That prevents two simultaneous checkout requests from both
     * successfully closing the same session.
     */
    const result =
      await db.transaction(
        async (tx) => {
          /*
           * Lock the booking itself.
           *
           * Different checkout requests for the same booking therefore
           * serialize until the first transaction finishes.
           */
          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                29003,
                ${bookingId}
              )
            `,
          );

          const [
            booking,
          ] =
            await tx
              .select()
              .from(
                bookings,
              )
              .where(
                eq(
                  bookings.id,
                  bookingId,
                ),
              )
              .limit(1);

          if (!booking) {
            throw new CheckoutError(
              "Session not found",
              404,
            );
          }

          if (
            booking.status ===
            "closed"
          ) {
            throw new CheckoutError(
              "Session already closed",
              400,
            );
          }

          if (
            booking.status !==
            "active"
          ) {
            throw new CheckoutError(
              "Session is not active",
              400,
            );
          }

          /*
           * Load F&B items inside the same transaction.
           */
          const items =
            await tx
              .select()
              .from(
                bookingItems,
              )
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
                const unitPrice =
                  parseFloat(
                    item.unitPrice,
                  );

                if (
                  !Number.isFinite(
                    unitPrice,
                  ) ||
                  unitPrice <
                    0
                ) {
                  throw new CheckoutError(
                    "Invalid item price in session",
                    500,
                  );
                }

                if (
                  !Number.isInteger(
                    item.quantity,
                  ) ||
                  item.quantity <=
                    0
                ) {
                  throw new CheckoutError(
                    "Invalid item quantity in session",
                    500,
                  );
                }

                return (
                  sum +
                  item.quantity *
                    unitPrice
                );
              },
              0,
            );

          /*
           * TIME
           */
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
           * Every started hour is billable.
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

          /*
           * BILLING
           *
           * Package:
           *   seat charge is always zero.
           *
           * Regular:
           *   use the configured Customer Session price.
           */
          const isPackage =
            booking.billingMode ===
            "package";

          const regularPricing =
            calculateSessionPrice(
              billableHours,
              sessionPricing,
            );

          const pricing =
            isPackage
              ? {
                  seatCharge: 0,
                  pricingType:
                    "package" as const,
                }
              : regularPricing;

          const seatCharge =
            pricing.seatCharge;

          /*
           * Discount cannot exceed the amount before discount.
           *
           * We reject the request rather than silently changing what
           * the cashier entered.
           */
          const subtotal =
            seatCharge +
            ordersTotal;

          if (
            discount >
            subtotal
          ) {
            throw new CheckoutError(
              "Discount cannot exceed the session subtotal",
              400,
            );
          }

          const total =
            Math.max(
              0,
              subtotal -
                discount,
            );

          /*
           * For non-cash payments we still keep the supplied paid amount
           * for the invoice/history, but checkout must cover the total.
           */
          if (
            paid < total
          ) {
            throw new CheckoutError(
              "Insufficient payment",
              400,
              {
                total,
                paid,
                billableHours,
                pricingType:
                  pricing.pricingType,
              },
            );
          }

          const change =
            paymentMethod ===
            "cash"
              ? Math.max(
                  0,
                  paid -
                    total,
                )
              : 0;

          /*
           * PACKAGE USAGE
           *
           * Package hours are the source of truth in the usage ledger.
           * We lock the subscription while calculating the balance so
           * concurrent sessions cannot both spend the same hours.
           */
          if (
            isPackage
          ) {
            if (
              !booking.subscriptionId
            ) {
              throw new CheckoutError(
                "Package session has no subscription",
                400,
              );
            }

            await tx.execute(
              sql`
                SELECT pg_advisory_xact_lock(
                  29002,
                  ${booking.subscriptionId}
                )
              `,
            );

            const [
              subscription,
            ] =
              await tx
                .select()
                .from(
                  customerSubscriptions,
                )
                .where(
                  eq(
                    customerSubscriptions.id,
                    booking.subscriptionId,
                  ),
                )
                .limit(1);

            if (
              !subscription
            ) {
              throw new CheckoutError(
                "Subscription not found",
                404,
              );
            }

            if (
              subscription.status !==
              "active"
            ) {
              throw new CheckoutError(
                "Subscription is not active",
                400,
              );
            }

            const now =
              new Date();

            if (
              subscription.startsAt >
              now
            ) {
              throw new CheckoutError(
                "Subscription has not started yet",
                400,
              );
            }

            if (
              subscription.expiresAt &&
              subscription.expiresAt <
                now
            ) {
              throw new CheckoutError(
                "Subscription has expired",
                400,
              );
            }

            const [
              balanceRow,
            ] =
              await tx
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

            const remainingHours =
              Number(
                balanceRow?.balance ??
                  0,
              );

            if (
              !Number.isFinite(
                remainingHours,
              )
            ) {
              throw new CheckoutError(
                "Invalid subscription balance",
                500,
              );
            }

            if (
              remainingHours <
              billableHours
            ) {
              throw new CheckoutError(
                `Not enough package hours. Remaining ${remainingHours.toFixed(
                  2,
                )}h, required ${billableHours}h.`,
                400,
                {
                  remainingHours,
                  requiredHours:
                    billableHours,
                },
              );
            }

            /*
             * Deterministic idempotency key.
             *
             * Retrying the same checkout cannot create a second usage entry.
             */
            const usageKey =
              `booking-checkout:${bookingId}`;

            const [
              existingUsage,
            ] =
              await tx
                .select({
                  id:
                    subscriptionUsageLedger.id,
                })
                .from(
                  subscriptionUsageLedger,
                )
                .where(
                  eq(
                    subscriptionUsageLedger.idempotencyKey,
                    usageKey,
                  ),
                )
                .limit(1);

            if (
              !existingUsage
            ) {
              await tx
                .insert(
                  subscriptionUsageLedger,
                )
                .values({
                  subscriptionId:
                    subscription.id,

                  bookingId:
                    bookingId,

                  userId:
                    user.id,

                  entryType:
                    "usage",

                  hoursDelta:
                    (
                      -billableHours
                    ).toFixed(
                      2,
                    ),

                  reason:
                    `Customer Session #${bookingId} package usage`,

                  idempotencyKey:
                    usageKey,
                });
            }
          }

          /*
           * Close the booking only after every validation above succeeds.
           *
           * WHERE status='active' is an extra defensive check.
           */
          const updated =
            await tx
              .update(
                bookings,
              )
              .set({
                checkedOutAt:
                  closedAt,

                seatCharge:
                  seatCharge.toFixed(
                    2,
                  ),

                ordersTotal:
                  ordersTotal.toFixed(
                    2,
                  ),

                discount:
                  discount.toFixed(
                    2,
                  ),

                total:
                  total.toFixed(
                    2,
                  ),

                paidAmount:
                  paid.toFixed(
                    2,
                  ),

                changeAmount:
                  change.toFixed(
                    2,
                  ),

                paymentMethod:
                  paymentMethod,

                subscriptionHoursUsed:
                  isPackage
                    ? billableHours.toFixed(
                        2,
                      )
                    : null,

                billingNote:
                  isPackage
                    ? `Package session checkout. ${billableHours}h consumed.`
                    : pricing.pricingType ===
                      "day"
                    ? "Customer Session Day Pass"
                    : `Customer Session ${billableHours} started hour${
                        billableHours ===
                        1
                          ? ""
                          : "s"
                      }`,

                status:
                  "closed",
              })
              .where(
                and(
                  eq(
                    bookings.id,
                    bookingId,
                  ),
                  eq(
                    bookings.status,
                    "active",
                  ),
                ),
              )
              .returning({
                id:
                  bookings.id,
              });

          if (
            updated.length ===
            0
          ) {
            throw new CheckoutError(
              "Session could not be closed. It may have been checked out already.",
              409,
            );
          }

          return {
            sessionId:
              bookingId,

            elapsedHours,

            billableHours,

            pricingType:
              pricing.pricingType,

            firstHourPrice:
              sessionPricing.oneHour,

            secondHourPrice:
              sessionPricing.twoHours,

            thirdHourPrice:
              sessionPricing.threeHours,

            fourthHourPrice:
              sessionPricing.fourHours,

            dayPassPrice:
              sessionPricing.dayPass,

            seatCharge,

            ordersTotal,

            discount,

            total,

            paid,

            change,

            isPackage,

            packageHoursUsed:
              isPackage
                ? billableHours
                : 0,
          };
        },
      );

    return NextResponse.json({
      ok: true,

      ...result,
    });
  } catch (error) {
    if (
      error instanceof
      CheckoutError
    ) {
      return NextResponse.json(
        {
          error:
            error.message,

          ...error.details,
        },
        {
          status:
            error.status,
        },
      );
    }

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

class CheckoutError extends Error {
  status: number;

  details: Record<
    string,
    unknown
  >;

  constructor(
    message: string,
    status: number,
    details: Record<
      string,
      unknown
    > = {},
  ) {
    super(message);

    this.name =
      "CheckoutError";

    this.status =
      status;

    this.details =
      details;
  }
}