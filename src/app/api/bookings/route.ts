import { NextResponse } from "next/server";

import crypto from "crypto";

import {
  and,
  eq,
  sql,
} from "drizzle-orm";

import { db } from "@/db";

import {
  auditLogs,
  bookings,
  customerSubscriptions,
  customers,
  subscriptionUsageLedger,
} from "@/db/schema";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  getActiveShiftForUser,
} from "@/lib/shift";

import {
  getCustomerSessionPricing,
} from "@/lib/settings";

export const dynamic =
  "force-dynamic";

/* -------------------------------------------------------------------------- */
/* TYPES                                                                      */
/* -------------------------------------------------------------------------- */

type Body = {
  customerId?: number;

  customerName?: string;

  customerPhone?: string;

  billingMode?:
    | "regular"
    | "package";

  subscriptionId?:
    | number
    | null;
};

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
/* ACCESS CODE                                                                */
/* -------------------------------------------------------------------------- */

function generateAccessCode(): string {
  return String(
    crypto.randomInt(
      1000,
      10000,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* ACCESS TOKEN                                                               */
/* -------------------------------------------------------------------------- */

function generateAccessToken(): string {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

function hashToken(
  token: string,
): string {
  return crypto
    .createHash(
      "sha256",
    )
    .update(token)
    .digest("hex");
}

/* -------------------------------------------------------------------------- */
/* HELPERS                                                                    */
/* -------------------------------------------------------------------------- */

function isValidPositiveInteger(
  value: unknown,
): value is number {
  return (
    typeof value ===
      "number" &&
    Number.isInteger(
      value,
    ) &&
    value > 0
  );
}

/* -------------------------------------------------------------------------- */
/* POST                                                                       */
/* -------------------------------------------------------------------------- */

export async function POST(
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
    /* ACTIVE SHIFT                                                            */
    /* ---------------------------------------------------------------------- */

    const activeShift =
      await getActiveShiftForUser(
        user.id,
      );

    if (!activeShift) {
      return NextResponse.json(
        {
          error:
            "No active shift. Open a shift before starting a customer session.",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* BODY                                                                    */
    /* ---------------------------------------------------------------------- */

    const body =
      (await req
        .json()
        .catch(
          () => null,
        )) as Body | null;

    if (!body) {
      return NextResponse.json(
        {
          error:
            "Invalid request.",
        },
        {
          status: 400,
        },
      );
    }

    const billingMode =
      body.billingMode ===
      "package"
        ? "package"
        : "regular";

    const suppliedCustomerId =
      isValidPositiveInteger(
        body.customerId,
      )
        ? body.customerId
        : null;

    const customerName =
      body.customerName?.trim() ||
      "";

    const rawPhone =
      body.customerPhone?.trim() ||
      "";

    const normalizedPhone =
      normalizePhone(
        rawPhone,
      );

    /* ---------------------------------------------------------------------- */
    /* VALIDATION                                                              */
    /* ---------------------------------------------------------------------- */

    if (
      !suppliedCustomerId &&
      !customerName
    ) {
      return NextResponse.json(
        {
          error:
            "Customer name is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !normalizedPhone ||
      normalizedPhone.length <
        8
    ) {
      return NextResponse.json(
        {
          error:
            "A valid customer phone number is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      billingMode ===
        "package" &&
      !isValidPositiveInteger(
        body.subscriptionId,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "A package subscription must be selected.",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* LOAD CURRENT CUSTOMER SESSION PRICING                                  */
    /* ---------------------------------------------------------------------- */

    const sessionPricing =
      await getCustomerSessionPricing();

    const pricingValues = [
      sessionPricing.oneHour,
      sessionPricing.twoHours,
      sessionPricing.threeHours,
      sessionPricing.fourHours,
      sessionPricing.dayPass,
    ];

    if (
      pricingValues.some(
        (value) =>
          !Number.isFinite(
            value,
          ) ||
          value < 0,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid Customer Session pricing configuration.",
        },
        {
          status: 500,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* TRANSACTION                                                             */
    /* ---------------------------------------------------------------------- */

    const result =
      await db.transaction(
        async (tx) => {
          /* ---------------------------------------------------------------- */
          /* CUSTOMER                                                           */
          /* ---------------------------------------------------------------- */

          let customer:
            | {
                id: number;
                name: string;
                phone: string;
              }
            | undefined;

          let customerWasCreated =
            false;

          if (
            suppliedCustomerId
          ) {
            const rows =
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
                    suppliedCustomerId,
                  ),
                )
                .limit(1);

            customer =
              rows[0];

            if (!customer) {
              throw new BookingError(
                "The selected customer no longer exists.",
              );
            }

            const selectedPhone =
              normalizePhone(
                customer.phone,
              );

            if (
              selectedPhone !==
              normalizedPhone
            ) {
              throw new BookingError(
                "The customer phone number does not match the selected customer.",
              );
            }
          } else {
            const rows =
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
                    customers.phoneNormalized,
                    normalizedPhone,
                  ),
                )
                .limit(1);

            customer =
              rows[0];

            if (!customer) {
              try {
                const inserted =
                  await tx
                    .insert(
                      customers,
                    )
                    .values({
                      name:
                        customerName,

                      phone:
                        rawPhone,

                      phoneNormalized:
                        normalizedPhone,
                    })
                    .returning({
                      id:
                        customers.id,

                      name:
                        customers.name,

                      phone:
                        customers.phone,
                    });

                customer =
                  inserted[0];

                customerWasCreated =
                  true;
              } catch (
                error
              ) {
                /*
                 * Another request may have created the same phone between
                 * our SELECT and INSERT. Re-read the canonical customer.
                 */
                const existing =
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
                        customers.phoneNormalized,
                        normalizedPhone,
                      ),
                    )
                    .limit(1);

                customer =
                  existing[0];

                if (
                  !customer
                ) {
                  throw error;
                }
              }
            }
          }

          if (!customer) {
            throw new BookingError(
              "Could not resolve the customer.",
            );
          }

          /* ---------------------------------------------------------------- */
          /* CUSTOMER LOCK                                                     */
          /* ---------------------------------------------------------------- */

          /*
           * This is important.
           *
           * Without a lock, two simultaneous requests can both execute
           * "SELECT active session" before either INSERT happens.
           */
          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                29005,
                ${customer.id}
              )
            `,
          );

          /* ---------------------------------------------------------------- */
          /* ONE ACTIVE SESSION PER CUSTOMER                                  */
          /* ---------------------------------------------------------------- */

          const activeSession =
            await tx
              .select({
                id:
                  bookings.id,
              })
              .from(
                bookings,
              )
              .where(
                and(
                  eq(
                    bookings.customerId,
                    customer.id,
                  ),

                  eq(
                    bookings.status,
                    "active",
                  ),
                ),
              )
              .limit(1);

          if (
            activeSession[0]
          ) {
            throw new BookingError(
              `This customer already has an active session (#${activeSession[0].id}).`,
            );
          }

          /* ---------------------------------------------------------------- */
          /* PACKAGE                                                           */
          /* ---------------------------------------------------------------- */

          let selectedSubscription:
            | {
                id: number;

                customerId: number;

                packageNameSnapshot: string;

                totalHoursSnapshot: string;

                priceSnapshot: string;

                startsAt: Date;

                expiresAt:
                  | Date
                  | null;

                status: string;
              }
            | undefined;

          let packageBalance =
            0;

          if (
            billingMode ===
            "package"
          ) {
            const subscriptionId =
              Number(
                body.subscriptionId,
              );

            if (
              !isValidPositiveInteger(
                subscriptionId,
              )
            ) {
              throw new BookingError(
                "Invalid package subscription.",
              );
            }

            /*
             * Lock the subscription as well.
             *
             * This protects the package balance against concurrent
             * operations touching the same subscription.
             */
            await tx.execute(
              sql`
                SELECT pg_advisory_xact_lock(
                  29002,
                  ${subscriptionId}
                )
              `,
            );

            const rows =
              await tx
                .select({
                  id:
                    customerSubscriptions.id,

                  customerId:
                    customerSubscriptions.customerId,

                  packageNameSnapshot:
                    customerSubscriptions.packageNameSnapshot,

                  totalHoursSnapshot:
                    customerSubscriptions.totalHoursSnapshot,

                  priceSnapshot:
                    customerSubscriptions.priceSnapshot,

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
                      customerSubscriptions.id,
                      subscriptionId,
                    ),

                    eq(
                      customerSubscriptions.customerId,
                      customer.id,
                    ),
                  ),
                )
                .limit(1);

            selectedSubscription =
              rows[0];

            if (
              !selectedSubscription
            ) {
              throw new BookingError(
                "The selected package does not belong to this customer.",
              );
            }

            if (
              selectedSubscription.status !==
              "active"
            ) {
              throw new BookingError(
                "The selected package is not active.",
              );
            }

            const now =
              new Date();

            if (
              selectedSubscription.startsAt >
              now
            ) {
              throw new BookingError(
                "The selected package has not started yet.",
              );
            }

            if (
              selectedSubscription.expiresAt &&
              selectedSubscription.expiresAt <=
                now
            ) {
              throw new BookingError(
                "The selected package has expired.",
              );
            }

            const balanceRows =
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
                    selectedSubscription.id,
                  ),
                );

            packageBalance =
              Number(
                balanceRows[0]
                  ?.balance ??
                  0,
              );

            if (
              !Number.isFinite(
                packageBalance,
              )
            ) {
              throw new BookingError(
                "Invalid package balance.",
              );
            }

            if (
              packageBalance <=
              0
            ) {
              throw new BookingError(
                "The selected package has no remaining hours.",
              );
            }
          }

          /* ---------------------------------------------------------------- */
          /* ACCESS TOKEN                                                      */
          /* ---------------------------------------------------------------- */

          const rawAccessToken =
            generateAccessToken();

          const accessTokenHash =
            hashToken(
              rawAccessToken,
            );

          /* ---------------------------------------------------------------- */
          /* ACCESS CODE                                                       */
          /* ---------------------------------------------------------------- */

          let createdBooking:
            | {
                id: number;

                accessCode: string;
              }
            | undefined;

          for (
            let attempt = 0;
            attempt < 50;
            attempt++
          ) {
            const accessCode =
              generateAccessCode();

            const existingCode =
              await tx
                .select({
                  id:
                    bookings.id,
                })
                .from(
                  bookings,
                )
                .where(
                  and(
                    eq(
                      bookings.accessCode,
                      accessCode,
                    ),

                    eq(
                      bookings.status,
                      "active",
                    ),
                  ),
                )
                .limit(1);

            if (
              existingCode[0]
            ) {
              continue;
            }

            try {
              const inserted =
                await tx
                  .insert(
                    bookings,
                  )
                  .values({
                    customerId:
                      customer.id,

                    /*
                     * Customer Session is not tied to a physical desk.
                     */
                    deskId:
                      null,

                    shiftId:
                      activeShift.id,

                    userId:
                      user.id,

                    accessCode,

                    accessTokenHash,

                    accessTokenCreatedAt:
                      new Date(),

                    checkedInAt:
                      new Date(),

                    /*
                     * Snapshot the configured first-hour price at the
                     * moment the session starts.
                     *
                     * Checkout still determines the final tier/day-pass
                     * from the business rules.
                     */
                    hourlyRateSnapshot:
                      sessionPricing.oneHour.toFixed(
                        2,
                      ),

                    billingMode,

                    subscriptionId:
                      billingMode ===
                      "package"
                        ? selectedSubscription!.id
                        : null,

                    status:
                      "active",

                    ordersTotal:
                      "0",

                    discount:
                      "0",

                    seatCharge:
                      "0",

                    total:
                      "0",

                    paidAmount:
                      "0",

                    changeAmount:
                      "0",
                  })
                  .returning({
                    id:
                      bookings.id,

                    accessCode:
                      bookings.accessCode,
                  });

              const booking =
                inserted[0];

              if (!booking) {
                throw new BookingError(
                  "Could not create the customer session.",
                );
              }

              createdBooking = {
                id:
                  booking.id,

                accessCode:
                  booking.accessCode!,
              };

              break;
            } catch (
              error
            ) {
              /*
               * Retry only for an access-code uniqueness collision.
               */
              const message =
                error instanceof
                Error
                  ? error.message.toLowerCase()
                  : "";

              if (
                message.includes(
                  "access_code",
                )
              ) {
                continue;
              }

              throw error;
            }
          }

          if (
            !createdBooking
          ) {
            throw new BookingError(
              "Could not generate a unique customer access code. Please try again.",
            );
          }

          /* ---------------------------------------------------------------- */
          /* AUDIT                                                             */
          /* ---------------------------------------------------------------- */

          if (
            customerWasCreated
          ) {
            await tx
              .insert(
                auditLogs,
              )
              .values({
                userId:
                  user.id,

                action:
                  "customer_created",

                entityType:
                  "customer",

                entityId:
                  customer.id,

                details: {
                  name:
                    customer.name,

                  phone:
                    customer.phone,

                  phoneNormalized:
                    normalizedPhone,
                },
              });
          }

          await tx
            .insert(
              auditLogs,
            )
            .values({
              userId:
                user.id,

              action:
                "session_started",

              entityType:
                "booking",

              entityId:
                createdBooking.id,

              details: {
                customerId:
                  customer.id,

                billingMode,

                subscriptionId:
                  billingMode ===
                  "package"
                    ? selectedSubscription!.id
                    : null,

                accessCode:
                  createdBooking.accessCode,

                /*
                 * Keep the configured prices that were active when the
                 * session started in the audit trail.
                 */
                pricingSnapshot:
                  {
                    oneHour:
                      sessionPricing.oneHour,

                    twoHours:
                      sessionPricing.twoHours,

                    threeHours:
                      sessionPricing.threeHours,

                    fourHours:
                      sessionPricing.fourHours,

                    dayPass:
                      sessionPricing.dayPass,
                  },
              },
            });

          return {
            bookingId:
              createdBooking.id,

            accessCode:
              createdBooking.accessCode,

            accessToken:
              rawAccessToken,

            customerId:
              customer.id,

            customerName:
              customer.name,

            customerPhone:
              customer.phone,

            billingMode,

            subscriptionId:
              billingMode ===
              "package"
                ? selectedSubscription!.id
                : null,

            packageBalance:
              billingMode ===
              "package"
                ? packageBalance
                : null,

            pricingSnapshot:
              {
                oneHour:
                  sessionPricing.oneHour,

                twoHours:
                  sessionPricing.twoHours,

                threeHours:
                  sessionPricing.threeHours,

                fourHours:
                  sessionPricing.fourHours,

                dayPass:
                  sessionPricing.dayPass,
              },
          };
        },
      );

    /* ---------------------------------------------------------------------- */
    /* RESPONSE                                                               */
    /* ---------------------------------------------------------------------- */

    return NextResponse.json({
      ok: true,

      bookingId:
        result.bookingId,

      accessCode:
        result.accessCode,

      /*
       * Returned only to the staff device.
       * The raw token is never stored in the database.
       */
      accessToken:
        result.accessToken,

      customerId:
        result.customerId,

      customerName:
        result.customerName,

      customerPhone:
        result.customerPhone,

      billingMode:
        result.billingMode,

      subscriptionId:
        result.subscriptionId,

      packageBalance:
        result.packageBalance,

      pricingSnapshot:
        result.pricingSnapshot,
    });
  } catch (
    error
  ) {
    console.error(
      "Start customer session error:",
      error,
    );

    if (
      error instanceof
      BookingError
    ) {
      return NextResponse.json(
        {
          error:
            error.message,
        },
        {
          status: 400,
        },
      );
    }

    const message =
      error instanceof
      Error
        ? error.message
        : "Could not start customer session.";

    return NextResponse.json(
      {
        error:
          message,
      },
      {
        status: 400,
      },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* ERROR                                                                      */
/* -------------------------------------------------------------------------- */

class BookingError extends Error {
  constructor(
    message: string,
  ) {
    super(message);

    this.name =
      "BookingError";
  }
}