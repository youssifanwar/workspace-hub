import { db } from "@/db";

import {
  bookings,
  customers,
  desks,
  bookingItems,
  categories,
  products,
  customerSubscriptions,
  subscriptionUsageLedger,
} from "@/db/schema";

import {
  and,
  asc,
  eq,
  sql,
} from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

import {
  redirect,
  notFound,
} from "next/navigation";

import { getSetting } from "@/lib/settings";

import BookingView from "./BookingView";

export const dynamic = "force-dynamic";

export default async function BookingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  /* ---------------------------------------------------------------------- */
  /* AUTH                                                                   */
  /* ---------------------------------------------------------------------- */

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const shift =
    await getActiveShiftForUser(
      user.id,
    );

  if (!shift) {
    redirect("/shift");
  }

  /* ---------------------------------------------------------------------- */
  /* BOOKING ID                                                             */
  /* ---------------------------------------------------------------------- */

  const bookingId = Number(id);

  if (
    !Number.isInteger(
      bookingId,
    ) ||
    bookingId <= 0
  ) {
    notFound();
  }

  /* ---------------------------------------------------------------------- */
  /* BOOKING                                                                */
  /* ---------------------------------------------------------------------- */

  const [row] = await db
    .select({
      id: bookings.id,

      status:
        bookings.status,

      customerName:
        customers.name,

      customerPhone:
        customers.phone,

      deskId:
        desks.id,

      deskName:
        desks.name,

      deskType:
        desks.type,

      checkedInAt:
        bookings.checkedInAt,

      hourlyRate:
        bookings.hourlyRateSnapshot,

      ordersTotal:
        bookings.ordersTotal,

      discount:
        bookings.discount,

      /* PACKAGE BILLING */

      billingMode:
        bookings.billingMode,

      subscriptionId:
        bookings.subscriptionId,

      subscriptionHoursUsed:
        bookings.subscriptionHoursUsed,
    })
    .from(bookings)
    .innerJoin(
      customers,
      eq(
        customers.id,
        bookings.customerId,
      ),
    )
    .leftJoin(
      desks,
      eq(
        desks.id,
        bookings.deskId,
      ),
    )
    .where(
      eq(
        bookings.id,
        bookingId,
      ),
    )
    .limit(1);

  if (!row) {
    notFound();
  }

  /* ---------------------------------------------------------------------- */
  /* CLOSED BOOKING                                                         */
  /* ---------------------------------------------------------------------- */

  if (
    row.status ===
    "closed"
  ) {
    redirect(
      `/invoice/${bookingId}`,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* SUBSCRIPTION                                                            */
  /* ---------------------------------------------------------------------- */

  let subscription:
    | {
        id: number;
        packageName: string;
        totalHours: number;
        price: number;
        validityDays:
          | number
          | null;
        startsAt: Date;
        expiresAt:
          | Date
          | null;
        remainingHours: number;
      }
    | null = null;

  if (
    row.billingMode ===
      "package" &&
    row.subscriptionId
  ) {
    const [
      subscriptionRow,
    ] = await db
      .select({
        id:
          customerSubscriptions.id,

        packageName:
          customerSubscriptions.packageNameSnapshot,

        totalHours:
          customerSubscriptions.totalHoursSnapshot,

        price:
          customerSubscriptions.priceSnapshot,

        validityDays:
          customerSubscriptions.validityDaysSnapshot,

        startsAt:
          customerSubscriptions.startsAt,

        expiresAt:
          customerSubscriptions.expiresAt,
      })
      .from(
        customerSubscriptions,
      )
      .where(
        and(
          eq(
            customerSubscriptions.id,
            row.subscriptionId,
          ),
          eq(
            customerSubscriptions.customerId,
            customers.id,
          ),
        ),
      )
      .limit(1);

    /*
     * The condition above references customers.id in a
     * query where customers is not part of FROM.
     *
     * Therefore, if no row is found, we'll load the
     * subscription by ID below.
     */
    if (subscriptionRow) {
      const [
        balanceRow,
      ] = await db
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
            subscriptionRow.id,
          ),
        );

      subscription = {
        id:
          subscriptionRow.id,

        packageName:
          subscriptionRow.packageName,

        totalHours:
          Number(
            subscriptionRow.totalHours,
          ),

        price:
          Number(
            subscriptionRow.price,
          ),

        validityDays:
          subscriptionRow.validityDays,

        startsAt:
          subscriptionRow.startsAt,

        expiresAt:
          subscriptionRow.expiresAt,

        remainingHours:
          Number(
            balanceRow?.balance ??
              0,
          ),
      };
    }
  }

  /*
   * Safe fallback: if the customer restriction in the
   * query above caused no result, fetch by subscription ID.
   */

  if (
    row.billingMode ===
      "package" &&
    row.subscriptionId &&
    !subscription
  ) {
    const [
      subscriptionRow,
    ] = await db
      .select({
        id:
          customerSubscriptions.id,

        packageName:
          customerSubscriptions.packageNameSnapshot,

        totalHours:
          customerSubscriptions.totalHoursSnapshot,

        price:
          customerSubscriptions.priceSnapshot,

        validityDays:
          customerSubscriptions.validityDaysSnapshot,

        startsAt:
          customerSubscriptions.startsAt,

        expiresAt:
          customerSubscriptions.expiresAt,
      })
      .from(
        customerSubscriptions,
      )
      .where(
        eq(
          customerSubscriptions.id,
          row.subscriptionId,
        ),
      )
      .limit(1);

    if (subscriptionRow) {
      const [
        balanceRow,
      ] = await db
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
            subscriptionRow.id,
          ),
        );

      subscription = {
        id:
          subscriptionRow.id,

        packageName:
          subscriptionRow.packageName,

        totalHours:
          Number(
            subscriptionRow.totalHours,
          ),

        price:
          Number(
            subscriptionRow.price,
          ),

        validityDays:
          subscriptionRow.validityDays,

        startsAt:
          subscriptionRow.startsAt,

        expiresAt:
          subscriptionRow.expiresAt,

        remainingHours:
          Number(
            balanceRow?.balance ??
              0,
          ),
      };
    }
  }

  /* ---------------------------------------------------------------------- */
  /* BOOKING ITEMS                                                          */
  /* ---------------------------------------------------------------------- */

  const items = await db
    .select()
    .from(bookingItems)
    .where(
      eq(
        bookingItems.bookingId,
        bookingId,
      ),
    )
    .orderBy(
      asc(
        bookingItems.createdAt,
      ),
    );

  /* ---------------------------------------------------------------------- */
  /* CATEGORIES                                                             */
  /* ---------------------------------------------------------------------- */

  const cats = await db
    .select()
    .from(categories)
    .orderBy(
      asc(
        categories.sortOrder,
      ),
    );

  /* ---------------------------------------------------------------------- */
  /* PRODUCTS                                                               */
  /* ---------------------------------------------------------------------- */

  const prods = await db
    .select()
    .from(products)
    .where(
      eq(
        products.active,
        true,
      ),
    )
    .orderBy(
      asc(products.name),
    );

  /* ---------------------------------------------------------------------- */
  /* CURRENCY                                                               */
  /* ---------------------------------------------------------------------- */

  const currency =
    await getSetting("currency");

  /* ---------------------------------------------------------------------- */
  /* BOOKING VIEW                                                           */
  /* ---------------------------------------------------------------------- */

  return (
    <BookingView
      booking={{
        id: row.id,

        customerName:
          row.customerName,

        customerPhone:
          row.customerPhone,

        deskName:
          row.deskName ??
          "Active Session",

        deskType:
          row.deskType ??
          "desk",

        checkedInAt:
          row.checkedInAt.toISOString(),

        hourlyRate:
          row.hourlyRate,

        ordersTotal:
          row.ordersTotal,

        discount:
          row.discount,

        billingMode:
          row.billingMode ===
          "package"
            ? "package"
            : "regular",

        subscriptionId:
          row.subscriptionId,

        subscriptionHoursUsed:
          row.subscriptionHoursUsed,
      }}

      subscription={
        subscription
          ? {
              id:
                subscription.id,

              packageName:
                subscription.packageName,

              totalHours:
                subscription.totalHours,

              price:
                subscription.price,

              validityDays:
                subscription.validityDays,

              startsAt:
                subscription.startsAt.toISOString(),

              expiresAt:
                subscription.expiresAt
                  ? subscription.expiresAt.toISOString()
                  : null,

              remainingHours:
                subscription.remainingHours,
            }
          : null
      }

      items={items.map(
        (item) => ({
          id: item.id,

          name:
            item.nameSnapshot,

          unitPrice:
            item.unitPrice,

          quantity:
            item.quantity,
        }),
      )}

      categories={cats.map(
        (category) => ({
          id: category.id,

          name:
            category.name,

          icon:
            category.icon,
        }),
      )}

      products={prods.map(
        (product) => ({
          id: product.id,

          categoryId:
            product.categoryId,

          name:
            product.name,

          price:
            product.price,

          imageUrl:
            product.imageUrl,

          icon:
            product.icon,
        }),
      )}

      currency={
        currency
      }
    />
  );
}