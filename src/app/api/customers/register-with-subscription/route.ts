import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

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

type Body = {
  name?: string;
  phone?: string;
  email?: string | null;
  packageId?: number | string;
  note?: string | null;
};

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (digits.startsWith("0020")) {
    return `20${digits.slice(4)}`;
  }

  if (digits.startsWith("20")) {
    return digits;
  }

  if (digits.startsWith("0")) {
    return `20${digits.slice(1)}`;
  }

  return digits;
}

function parseId(value: unknown): number | null {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

export async function POST(req: Request) {
  try {
    /* ---------------------------------------------------------------------- */
    /* AUTH                                                                   */
    /* ---------------------------------------------------------------------- */

    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* SHIFT                                                                  */
    /* ---------------------------------------------------------------------- */

    const shift = await getActiveShiftForUser(user.id);

    if (!shift) {
      return NextResponse.json(
        {
          error:
            "No active shift. Open a shift before registering a customer and selling a package.",
        },
        { status: 400 },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* BODY                                                                   */
    /* ---------------------------------------------------------------------- */

    const body =
      (await req.json().catch(() => null)) as Body | null;

    if (!body) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 },
      );
    }

    const name = body.name?.trim() || "";
    const phone = body.phone?.trim() || "";
    const email = body.email?.trim() || null;

    const packageId = parseId(body.packageId);

    if (!name) {
      return NextResponse.json(
        { error: "Customer name is required." },
        { status: 400 },
      );
    }

    if (!phone) {
      return NextResponse.json(
        { error: "Customer phone is required." },
        { status: 400 },
      );
    }

    const phoneNormalized = normalizePhone(phone);

    if (!phoneNormalized || phoneNormalized.length < 8) {
      return NextResponse.json(
        {
          error: "A valid customer phone number is required.",
        },
        { status: 400 },
      );
    }

    if (!packageId) {
      return NextResponse.json(
        {
          error: "A valid package ID is required.",
        },
        { status: 400 },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* TRANSACTION                                                             */
    /* ---------------------------------------------------------------------- */

    const result = await db.transaction(async (tx) => {
      /* -------------------------------------------------------------------- */
      /* DUPLICATE CUSTOMER CHECK                                             */
      /* -------------------------------------------------------------------- */

      const existingRows = await tx
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
        })
        .from(customers)
        .where(
          eq(
            customers.phoneNormalized,
            phoneNormalized,
          ),
        )
        .limit(1);

      const existingCustomer = existingRows[0];

      if (existingCustomer) {
        throw new Error(
          `A customer with this phone number already exists: ${existingCustomer.name} (#${existingCustomer.id}).`,
        );
      }

      /* -------------------------------------------------------------------- */
      /* PACKAGE                                                              */
      /* -------------------------------------------------------------------- */

      const packageRows = await tx
        .select({
          id: subscriptionPackages.id,
          name: subscriptionPackages.name,
          totalHours: subscriptionPackages.totalHours,
          price: subscriptionPackages.price,
          validityDays: subscriptionPackages.validityDays,
          active: subscriptionPackages.active,
        })
        .from(subscriptionPackages)
        .where(
          eq(
            subscriptionPackages.id,
            packageId,
          ),
        )
        .limit(1);

      const pkg = packageRows[0];

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

      /* -------------------------------------------------------------------- */
      /* CREATE CUSTOMER                                                      */
      /* -------------------------------------------------------------------- */

      const customerInserted = await tx
        .insert(customers)
        .values({
          name,
          phone,
          phoneNormalized,
          email,
        })
        .returning({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
        });

      const customer = customerInserted[0];

      if (!customer) {
        throw new Error(
          "Could not create customer.",
        );
      }

      /* -------------------------------------------------------------------- */
      /* DATES                                                                 */
      /* -------------------------------------------------------------------- */

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

      /* -------------------------------------------------------------------- */
      /* CREATE SUBSCRIPTION                                                   */
      /* -------------------------------------------------------------------- */

      const subscriptionInserted = await tx
        .insert(customerSubscriptions)
        .values({
          customerId: customer.id,
          packageId: pkg.id,

          packageNameSnapshot: pkg.name,

          totalHoursSnapshot:
            Number(pkg.totalHours).toFixed(2),

          priceSnapshot:
            Number(pkg.price).toFixed(2),

          validityDaysSnapshot:
            pkg.validityDays,

          purchasedAt: now,
          startsAt: now,
          expiresAt,

          status: "active",

          note: body.note?.trim() || null,

          createdByUserId: user.id,
        })
        .returning({
          id: customerSubscriptions.id,
        });

      const subscription = subscriptionInserted[0];

      if (!subscription) {
        throw new Error(
          "Could not create customer subscription.",
        );
      }

      /* -------------------------------------------------------------------- */
      /* INITIAL HOURS CREDIT                                                  */
      /* -------------------------------------------------------------------- */

      await tx
        .insert(subscriptionUsageLedger)
        .values({
          subscriptionId: subscription.id,

          bookingId: null,

          userId: user.id,

          entryType: "purchase",

          hoursDelta:
            Number(pkg.totalHours).toFixed(2),

          reason:
            `Purchased package "${pkg.name}" for new customer`,

          idempotencyKey:
            `subscription_purchase_${subscription.id}`,
        });

      /* -------------------------------------------------------------------- */
      /* AUDIT - CUSTOMER CREATED                                              */
      /* -------------------------------------------------------------------- */

      await tx
        .insert(auditLogs)
        .values({
          userId: user.id,

          action: "customer_created",

          entityType: "customer",

          entityId: customer.id,

          details: {
            name: customer.name,
            phone: customer.phone,
            phoneNormalized,
            createdWithPackage: true,
            packageId: pkg.id,
            packageName: pkg.name,
          },
        });

      /* -------------------------------------------------------------------- */
      /* AUDIT - SUBSCRIPTION PURCHASED                                        */
      /* -------------------------------------------------------------------- */

      await tx
        .insert(auditLogs)
        .values({
          userId: user.id,

          action: "subscription_purchased",

          entityType: "customer_subscription",

          entityId: subscription.id,

          details: {
            customerId: customer.id,
            customerName: customer.name,

            packageId: pkg.id,
            packageName: pkg.name,

            totalHours:
              Number(pkg.totalHours),

            price:
              Number(pkg.price),

            validityDays:
              pkg.validityDays,

            expiresAt:
              expiresAt
                ? expiresAt.toISOString()
                : null,

            newCustomer: true,
          },
        });

      return {
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,

        subscriptionId:
          subscription.id,

        packageId: pkg.id,
        packageName: pkg.name,

        totalHours:
          Number(pkg.totalHours),

        price:
          Number(pkg.price),

        validityDays:
          pkg.validityDays,

        startsAt: now,
        expiresAt,
      };
    });

    /* ---------------------------------------------------------------------- */
    /* RESPONSE                                                               */
    /* ---------------------------------------------------------------------- */

    return NextResponse.json(
      {
        ok: true,

        customer: {
          id: result.customerId,
          name: result.customerName,
          phone: result.customerPhone,
        },

        subscription: {
          id: result.subscriptionId,

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

          status: "active",

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

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not register customer with package.",
      },
      {
        status: 400,
      },
    );
  }
}