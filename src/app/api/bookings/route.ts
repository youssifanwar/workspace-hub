import { NextResponse } from "next/server";
import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  auditLogs,
  bookings,
  customerSubscriptions,
  customers,
  subscriptionUsageLedger,
} from "@/db/schema";

import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export const dynamic = "force-dynamic";

// ============================================================================
// TYPES
// ============================================================================

type Body = {
  customerId?: number;
  customerName?: string;
  customerPhone?: string;

  billingMode?: "regular" | "package";

  subscriptionId?: number | null;
};

// ============================================================================
// PHONE NORMALIZATION
// ============================================================================

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  // 0020XXXXXXXXXX -> 20XXXXXXXXXX
  if (digits.startsWith("0020")) {
    return `20${digits.slice(4)}`;
  }

  // 20XXXXXXXXXX -> already normalized
  if (digits.startsWith("20")) {
    return digits;
  }

  // 0XXXXXXXXXX -> 20XXXXXXXXXX
  if (digits.startsWith("0")) {
    return `20${digits.slice(1)}`;
  }

  return digits;
}

// ============================================================================
// ACCESS CODE
// ============================================================================

function generateAccessCode(): string {
  // 1000 - 9999
  // Avoids codes such as 0000.
  return String(
    crypto.randomInt(1000, 10000),
  );
}

// ============================================================================
// SECURE CUSTOMER ACCESS TOKEN
// ============================================================================

function generateAccessToken(): string {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

function hashToken(
  token: string,
): string {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

// ============================================================================
// MAIN
// ============================================================================

export async function POST(
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
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    // ------------------------------------------------------------------------
    // ACTIVE SHIFT
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // BODY
    // ------------------------------------------------------------------------

    const body =
      (await req
        .json()
        .catch(() => null)) as Body | null;

    if (!body) {
      return NextResponse.json(
        {
          error: "Invalid request.",
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
      Number.isInteger(
        body.customerId,
      ) && body.customerId! > 0
        ? body.customerId!
        : null;

    const customerName =
      body.customerName
        ?.trim() || "";

    const rawPhone =
      body.customerPhone
        ?.trim() || "";

    const normalizedPhone =
      normalizePhone(
        rawPhone,
      );

    // ------------------------------------------------------------------------
    // VALIDATION
    // ------------------------------------------------------------------------

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
      normalizedPhone.length < 8
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
      !body.subscriptionId
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

    // ------------------------------------------------------------------------
    // TRANSACTION
    // ------------------------------------------------------------------------

    const result =
      await db.transaction(
        async (tx) => {
          // ------------------------------------------------------------------
          // LOCK CUSTOMER BY PHONE SEARCH
          //
          // We first find an existing customer using normalized phone.
          // The database UNIQUE index is still the final protection.
          // ------------------------------------------------------------------

          let customer:
            | {
                id: number;
                name: string;
                phone: string;
              }
            | undefined;

          let customerWasCreated =
            false;

          // If the UI explicitly supplied a customerId, verify it.
          if (suppliedCustomerId) {
            const rows =
              await tx
                .select({
                  id: customers.id,
                  name: customers.name,
                  phone: customers.phone,
                })
                .from(customers)
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
              throw new Error(
                "The selected customer no longer exists.",
              );
            }

            // The phone must still belong to this customer.
            const customerNormalized =
              normalizePhone(
                customer.phone,
              );

            if (
              customerNormalized !==
              normalizedPhone
            ) {
              throw new Error(
                "The customer phone number does not match the selected customer.",
              );
            }
          } else {
            // Search by canonical phone.
            const rows =
              await tx
                .select({
                  id: customers.id,
                  name: customers.name,
                  phone: customers.phone,
                })
                .from(customers)
                .where(
                  eq(
                    customers.phoneNormalized,
                    normalizedPhone,
                  ),
                )
                .limit(1);

            customer =
              rows[0];

            // ---------------------------------------------------------------
            // EXISTING CUSTOMER
            // ---------------------------------------------------------------

            if (customer) {
              // IMPORTANT:
              // Do NOT overwrite the customer's stored name automatically.
              // Existing customer profile remains the source of truth.
            } else {
              // -------------------------------------------------------------
              // NEW CUSTOMER
              // -------------------------------------------------------------

              const inserted =
                await tx
                  .insert(customers)
                  .values({
                    name:
                      customerName,
                    phone:
                      rawPhone,
                    phoneNormalized:
                      normalizedPhone,
                  })
                  .returning({
                    id: customers.id,
                    name: customers.name,
                    phone: customers.phone,
                  });

              customer =
                inserted[0];

              if (!customer) {
                throw new Error(
                  "Could not create the customer.",
                );
              }

              customerWasCreated =
                true;
            }
          }

          // ------------------------------------------------------------------
          // ONE ACTIVE SESSION PER CUSTOMER
          //
          // A customer cannot accidentally be checked in twice at once.
          // ------------------------------------------------------------------

          const activeSession =
            await tx
              .select({
                id: bookings.id,
              })
              .from(bookings)
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
            throw new Error(
              `This customer already has an active session (#${activeSession[0].id}).`,
            );
          }

          // ------------------------------------------------------------------
          // PACKAGE VALIDATION
          // ------------------------------------------------------------------

          let selectedSubscription:
            | {
                id: number;
                customerId: number;
                packageNameSnapshot: string;
                totalHoursSnapshot: string;
                priceSnapshot: string;
                startsAt: Date;
                expiresAt: Date | null;
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
              !Number.isInteger(
                subscriptionId,
              ) ||
              subscriptionId <= 0
            ) {
              throw new Error(
                "Invalid package subscription.",
              );
            }

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
              throw new Error(
                "The selected package does not belong to this customer.",
              );
            }

            if (
              selectedSubscription.status !==
              "active"
            ) {
              throw new Error(
                "The selected package is not active.",
              );
            }

            const now =
              new Date();

            if (
              selectedSubscription.startsAt >
              now
            ) {
              throw new Error(
                "The selected package has not started yet.",
              );
            }

            if (
              selectedSubscription.expiresAt &&
              selectedSubscription.expiresAt <=
                now
            ) {
              throw new Error(
                "The selected package has expired.",
              );
            }

            // ---------------------------------------------------------------
            // LEDGER BALANCE
            // ---------------------------------------------------------------

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
                  ?.balance ?? 0,
              );

            // Never allow a package with no remaining time.
            if (
              packageBalance <=
              0
            ) {
              throw new Error(
                "The selected package has no remaining hours.",
              );
            }
          }

          // ------------------------------------------------------------------
          // ACCESS TOKEN
          // ------------------------------------------------------------------

          const rawAccessToken =
            generateAccessToken();

          const accessTokenHash =
            hashToken(
              rawAccessToken,
            );

          // ------------------------------------------------------------------
          // RANDOM 4-DIGIT ACCESS CODE
          //
          // We retry in the very unlikely event of a collision with another
          // active session.
          // ------------------------------------------------------------------

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
                  id: bookings.id,
                })
                .from(bookings)
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
                  .insert(bookings)
                  .values({
                    customerId:
                      customer.id,

                    // Session is independent from physical location.
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

                    // Kept only for backward compatibility.
                    // Actual regular pricing is handled by the new pricing
                    // system, not this field.
                    hourlyRateSnapshot:
                      "0",

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
                  })
                  .returning({
                    id: bookings.id,
                    accessCode:
                      bookings.accessCode,
                  });

              const booking =
                inserted[0];

              if (!booking) {
                throw new Error(
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
            } catch (error) {
              // A database UNIQUE collision can theoretically happen between
              // our check and INSERT. Retry with another random code.
              const message =
                error instanceof
                Error
                  ? error.message
                  : "";

              if (
                message
                  .toLowerCase()
                  .includes(
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
            throw new Error(
              "Could not generate a unique customer access code. Please try again.",
            );
          }

          // ------------------------------------------------------------------
          // AUDIT
          // ------------------------------------------------------------------

          if (
            customerWasCreated
          ) {
            await tx.insert(
              auditLogs,
            ).values({
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

          await tx.insert(
            auditLogs,
          ).values({
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
          };
        },
      );

    // ------------------------------------------------------------------------
    // RESPONSE
    // ------------------------------------------------------------------------

    return NextResponse.json({
      ok: true,

      bookingId:
        result.bookingId,

      accessCode:
        result.accessCode,

      // Returned only once to the staff device.
      // We do not store the raw token in the database.
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
    });
  } catch (error) {
    console.error(
      "Start customer session error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Could not start customer session.";

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 400,
      },
    );
  }
}