import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

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

export const dynamic = "force-dynamic";

type PurchaseBody = {
  packageId?: number | string;
  note?: string | null;
};

function parseId(value: string) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

/* -------------------------------------------------------------------------- */
/* GET ACTIVE SUBSCRIPTION                                                    */
/* -------------------------------------------------------------------------- */

export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  },
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { id: rawId } = await params;
    const customerId = parseId(rawId);

    if (!customerId) {
      return NextResponse.json(
        { error: "Invalid customer ID." },
        { status: 400 },
      );
    }

    const customerRows = await db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
      })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);

    const customer = customerRows[0];

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found." },
        { status: 404 },
      );
    }

    const subscriptionRows = await db
      .select({
        id: customerSubscriptions.id,
        packageId: customerSubscriptions.packageId,
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
      .from(customerSubscriptions)
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
        ),
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

    const balanceRows = await db
      .select({
        balance: sql<string>`
          COALESCE(
            SUM(
              ${subscriptionUsageLedger.hoursDelta}
            ),
            0
          )
        `,
      })
      .from(subscriptionUsageLedger)
      .where(
        eq(
          subscriptionUsageLedger.subscriptionId,
          subscription.id,
        ),
      );

    const balance = Number(
      balanceRows[0]?.balance ?? 0,
    );

    return NextResponse.json({
      active: true,
      subscription: {
        id: subscription.id,
        packageId: subscription.packageId,
        packageName:
          subscription.packageName,
        totalHours:
          Number(subscription.totalHours),
        price:
          Number(subscription.price),
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
        remainingHours: balance,
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
    params: Promise<{ id: string }>;
  },
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const shift =
      await getActiveShiftForUser(user.id);

    if (!shift) {
      return NextResponse.json(
        {
          error:
            "No active shift. Open a shift before selling a package.",
        },
        {
          status: 400,
        },
      );
    }

    const { id: rawId } = await params;
    const customerId = parseId(rawId);

    if (!customerId) {
      return NextResponse.json(
        { error: "Invalid customer ID." },
        { status: 400 },
      );
    }

    const body =
      (await req
        .json()
        .catch(() => null)) as PurchaseBody | null;

    if (!body) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 },
      );
    }

    const packageId = parseId(
      String(body.packageId ?? ""),
    );

    if (!packageId) {
      return NextResponse.json(
        {
          error:
            "A valid package ID is required.",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      await db.transaction(
        async (tx) => {
          /* ------------------------------------------------------------------ */
          /* CUSTOMER                                                            */
          /* ------------------------------------------------------------------ */

          const customerRows =
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
                  customerId,
                ),
              )
              .limit(1);

          const customer =
            customerRows[0];

          if (!customer) {
            throw new Error(
              "Customer not found.",
            );
          }

          /* ------------------------------------------------------------------ */
          /* ACTIVE SUBSCRIPTION CHECK                                          */
          /* ------------------------------------------------------------------ */

          const activeRows =
            await tx
              .select({
                id:
                  customerSubscriptions.id,
                packageName:
                  customerSubscriptions.packageNameSnapshot,
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
                ),
              )
              .limit(1);

          if (activeRows[0]) {
            throw new Error(
              `Customer already has an active package: ${activeRows[0].packageName}.`,
            );
          }

          /* ------------------------------------------------------------------ */
          /* PACKAGE                                                             */
          /* ------------------------------------------------------------------ */

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
            throw new Error(
              "Subscription package not found.",
            );
          }

          if (!pkg.active) {
            throw new Error(
              "This package is not available for new purchases.",
            );
          }

          /* ------------------------------------------------------------------ */
          /* DATES                                                               */
          /* ------------------------------------------------------------------ */

          const now = new Date();

          const expiresAt =
            pkg.validityDays !== null &&
            pkg.validityDays !== undefined
              ? new Date(
                  now.getTime() +
                    pkg.validityDays *
                      24 *
                      60 *
                      60 *
                      1000,
                )
              : null;

          /* ------------------------------------------------------------------ */
          /* CREATE CUSTOMER SUBSCRIPTION                                       */
          /* ------------------------------------------------------------------ */

          const inserted =
            await tx
              .insert(
                customerSubscriptions,
              )
              .values({
                customerId,

                packageId,

                packageNameSnapshot:
                  pkg.name,

                totalHoursSnapshot:
                  Number(
                    pkg.totalHours,
                  ).toFixed(2),

                priceSnapshot:
                  Number(
                    pkg.price,
                  ).toFixed(2),

                validityDaysSnapshot:
                  pkg.validityDays,

                purchasedAt: now,

                startsAt: now,

                expiresAt,

                status: "active",

                note:
                  body.note?.trim() ||
                  null,

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
            throw new Error(
              "Could not create customer subscription.",
            );
          }

          /* ------------------------------------------------------------------ */
          /* INITIAL LEDGER CREDIT                                               */
          /* ------------------------------------------------------------------ */

          await tx
            .insert(
              subscriptionUsageLedger,
            )
            .values({
              subscriptionId:
                subscription.id,

              bookingId: null,

              userId: user.id,

              entryType:
                "package_purchase",

              hoursDelta:
                Number(
                  pkg.totalHours,
                ).toFixed(2),

              reason:
                `Purchased package "${pkg.name}"`,

              idempotencyKey:
                `subscription_purchase_${subscription.id}`,
            });

          /* ------------------------------------------------------------------ */
          /* AUDIT                                                               */
          /* ------------------------------------------------------------------ */

          await tx
            .insert(auditLogs)
            .values({
              userId: user.id,

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

                totalHours:
                  Number(
                    pkg.totalHours,
                  ),

                price:
                  Number(
                    pkg.price,
                  ),

                validityDays:
                  pkg.validityDays,

                expiresAt:
                  expiresAt
                    ? expiresAt.toISOString()
                    : null,
              },
            });

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

            totalHours:
              Number(
                pkg.totalHours,
              ),

            price:
              Number(
                pkg.price,
              ),

            validityDays:
              pkg.validityDays,

            startsAt:
              now,

            expiresAt,
          };
        },
      );

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

          price:
            result.price,

          validityDays:
            result.validityDays,

          remainingHours:
            result.totalHours,

          startsAt:
            result.startsAt.toISOString(),

          expiresAt:
            result.expiresAt
              ? result.expiresAt.toISOString()
              : null,

          status: "active",
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

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not purchase subscription.",
      },
      {
        status: 400,
      },
    );
  }
}