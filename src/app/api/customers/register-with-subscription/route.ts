import { NextResponse } from "next/server";

import {
  eq,
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

type Body = {
  name?: string;
  phone?: string;
  email?: string | null;
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
    digits.startsWith("0")
  ) {
    return `20${digits.slice(1)}`;
  }

  return digits;
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

function normalizeEmail(
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
      "Invalid email address.",
      400,
    );
  }

  const email =
    value.trim();

  if (!email) {
    return null;
  }

  if (
    email.length >
    320
  ) {
    throw new ApiError(
      "Email address is too long.",
      400,
    );
  }

  const emailPattern =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (
    !emailPattern.test(
      email,
    )
  ) {
    throw new ApiError(
      "Invalid email address.",
      400,
    );
  }

  return email;
}

function normalizeNote(
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
    /* ACTIVE SHIFT                                                           */
    /* ---------------------------------------------------------------------- */

    const shift =
      await getActiveShiftForUser(
        user.id,
      );

    if (!shift) {
      throw new ApiError(
        "No active shift. Open a shift before registering a customer and selling a package.",
        400,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* REQUEST BODY                                                            */
    /* ---------------------------------------------------------------------- */

    const body =
      (await req
        .json()
        .catch(
          () => null,
        )) as
        | Body
        | null;

    if (!body) {
      throw new ApiError(
        "Invalid request.",
        400,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* CUSTOMER NAME                                                          */
    /* ---------------------------------------------------------------------- */

    const name =
      typeof body.name ===
      "string"
        ? body.name.trim()
        : "";

    if (!name) {
      throw new ApiError(
        "Customer name is required.",
        400,
      );
    }

    if (
      name.length >
      200
    ) {
      throw new ApiError(
        "Customer name is too long.",
        400,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* PHONE                                                                  */
    /* ---------------------------------------------------------------------- */

    const phone =
      typeof body.phone ===
      "string"
        ? body.phone.trim()
        : "";

    if (!phone) {
      throw new ApiError(
        "Customer phone is required.",
        400,
      );
    }

    const phoneNormalized =
      normalizePhone(
        phone,
      );

    if (
      !phoneNormalized ||
      phoneNormalized.length <
        8
    ) {
      throw new ApiError(
        "A valid customer phone number is required.",
        400,
      );
    }

    if (
      phoneNormalized.length >
      20
    ) {
      throw new ApiError(
        "Customer phone number is too long.",
        400,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* EMAIL                                                                  */
    /* ---------------------------------------------------------------------- */

    const email =
      normalizeEmail(
        body.email,
      );

    /* ---------------------------------------------------------------------- */
    /* PACKAGE                                                                */
    /* ---------------------------------------------------------------------- */

    const packageId =
      parseId(
        body.packageId,
      );

    if (!packageId) {
      throw new ApiError(
        "A valid package ID is required.",
        400,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* NOTE                                                                   */
    /* ---------------------------------------------------------------------- */

    const note =
      normalizeNote(
        body.note,
      );

    /* ---------------------------------------------------------------------- */
    /* TRANSACTION                                                            */
    /* ---------------------------------------------------------------------- */

    const result =
      await db.transaction(
        async (tx) => {
          /* ---------------------------------------------------------------- */
          /* PHONE LOCK                                                        */
          /* ---------------------------------------------------------------- */

          /*
           * Serialize registrations for the same normalized phone number.
           * This prevents two concurrent requests from both passing the
           * "customer does not exist" check.
           */
          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                hashtextextended(
                  ${phoneNormalized},
                  0
                )
              )
            `,
          );

          /* ---------------------------------------------------------------- */
          /* DUPLICATE CUSTOMER CHECK                                         */
          /* ---------------------------------------------------------------- */

          const existingRows =
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
                  phoneNormalized,
                ),
              )
              .limit(1);

          const existingCustomer =
            existingRows[0];

          if (
            existingCustomer
          ) {
            throw new ApiError(
              `A customer with this phone number already exists: ${existingCustomer.name} (#${existingCustomer.id}).`,
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
          /* PACKAGE VALIDATION                                               */
          /* ---------------------------------------------------------------- */

          const totalHours =
            Number(
              pkg.totalHours,
            );

          const packagePrice =
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
              packagePrice,
            ) ||
            packagePrice < 0
          ) {
            throw new ApiError(
              "Subscription package has an invalid price.",
              500,
            );
          }

          if (
            pkg.validityDays !==
              null &&
            pkg.validityDays !==
              undefined &&
            (
              !Number.isSafeInteger(
                pkg.validityDays,
              ) ||
              pkg.validityDays <=
                0
            )
          ) {
            throw new ApiError(
              "Subscription package has an invalid validity period.",
              500,
            );
          }

          /* ---------------------------------------------------------------- */
          /* CREATE CUSTOMER                                                  */
          /* ---------------------------------------------------------------- */

          const customerInserted =
            await tx
              .insert(
                customers,
              )
              .values({
                name,

                phone,

                phoneNormalized,

                email,
              })
              .returning({
                id:
                  customers.id,

                name:
                  customers.name,

                phone:
                  customers.phone,
              });

          const customer =
            customerInserted[0];

          if (!customer) {
            throw new ApiError(
              "Could not create customer.",
              500,
            );
          }

          /* ---------------------------------------------------------------- */
          /* DATES                                                            */
          /* ---------------------------------------------------------------- */

          const now =
            new Date();

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

          const subscriptionInserted =
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
                  packagePrice.toFixed(
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
            subscriptionInserted[0];

          if (!subscription) {
            throw new ApiError(
              "Could not create customer subscription.",
              500,
            );
          }

          /* ---------------------------------------------------------------- */
          /* INITIAL HOURS CREDIT                                             */
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
                `Purchased package "${pkg.name}" for new customer`,

              idempotencyKey:
                `subscription_purchase_${subscription.id}`,
            });

          /* ---------------------------------------------------------------- */
          /* AUDIT - CUSTOMER                                                 */
          /* ---------------------------------------------------------------- */

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

                phoneNormalized,

                email,

                createdWithPackage:
                  true,

                packageId:
                  pkg.id,

                packageName:
                  pkg.name,

                shiftId:
                  shift.id,
              },
            });

          /* ---------------------------------------------------------------- */
          /* AUDIT - SUBSCRIPTION                                             */
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

                price:
                  packagePrice,

                validityDays:
                  pkg.validityDays,

                expiresAt:
                  expiresAt
                    ? expiresAt.toISOString()
                    : null,

                newCustomer:
                  true,

                shiftId:
                  shift.id,
              },
            });

          /* ---------------------------------------------------------------- */
          /* RESULT                                                           */
          /* ---------------------------------------------------------------- */

          return {
            customerId:
              customer.id,

            customerName:
              customer.name,

            customerPhone:
              customer.phone,

            subscriptionId:
              subscription.id,

            packageId:
              pkg.id,

            packageName:
              pkg.name,

            totalHours,

            price:
              packagePrice,

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

        customer: {
          id:
            result.customerId,

          name:
            result.customerName,

          phone:
            result.customerPhone,
        },

        subscription: {
          id:
            result.subscriptionId,

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
      "Register new customer with subscription error:",
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
          "Could not register customer with package.",
      },
      {
        status: 500,
      },
    );
  }
}