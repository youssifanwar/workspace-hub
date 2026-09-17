import { NextResponse } from "next/server";

import { db } from "@/db";

import {
  bookings,
  bookingItems,
  products,
} from "@/db/schema";

import {
  and,
  eq,
  sql,
} from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";

import { getActiveShiftForUser } from "@/lib/shift";

/* -------------------------------------------------------------------------- */
/* HELPERS                                                                    */
/* -------------------------------------------------------------------------- */

function parsePositiveInteger(
  value: unknown,
): number | null {
  const number =
    typeof value ===
    "number"
      ? value
      : Number(value);

  if (
    !Number.isFinite(
      number,
    ) ||
    !Number.isInteger(
      number,
    ) ||
    number <= 0
  ) {
    return null;
  }

  return number;
}

function parseBookingId(
  id: string,
): number | null {
  const bookingId =
    Number(id);

  if (
    !Number.isInteger(
      bookingId,
    ) ||
    bookingId <= 0
  ) {
    return null;
  }

  return bookingId;
}

function getErrorMessage(
  error: unknown,
): string {
  if (
    error instanceof
    Error
  ) {
    return error.message;
  }

  return "Request failed.";
}

/* -------------------------------------------------------------------------- */
/* POST - ADD PRODUCT TO SESSION                                              */
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
    const { id } =
      await params;

    const bookingId =
      parseBookingId(id);

    if (!bookingId) {
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

    let body: {
      productId?: number;
      quantity?: number;
    };

    try {
      body =
        (await req.json()) as {
          productId?: number;
          quantity?: number;
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

    const productId =
      parsePositiveInteger(
        body.productId,
      );

    if (!productId) {
      return NextResponse.json(
        {
          error:
            "productId required",
        },
        {
          status: 400,
        },
      );
    }

    const quantity =
      body.quantity ===
        undefined ||
      body.quantity ===
        null
        ? 1
        : parsePositiveInteger(
            body.quantity,
          );

    if (!quantity) {
      return NextResponse.json(
        {
          error:
            "quantity must be a positive integer",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * Serialize operations for this booking.
     *
     * This prevents two simultaneous add/update requests from observing
     * inconsistent booking state.
     */
    const result =
      await db.transaction(
        async (
          tx,
        ) => {
          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                29006,
                ${bookingId}
              )
            `,
          );

          /* ---------------------------------------------------------------- */
          /* BOOKING                                                           */
          /* ---------------------------------------------------------------- */

          const [
            booking,
          ] =
            await tx
              .select({
                id:
                  bookings.id,

                status:
                  bookings.status,

                shiftId:
                  bookings.shiftId,
              })
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
            throw new ItemsError(
              "Session not found",
              404,
            );
          }

          if (
            booking.status !==
            "active"
          ) {
            throw new ItemsError(
              "Session is not active",
              409,
            );
          }

          /*
           * The user must work on an active shift.
           *
           * Also require the booking itself to belong to the currently
           * active shift so an old session cannot be edited from a new shift.
           */
          if (
            booking.shiftId !==
            shift.id
          ) {
            throw new ItemsError(
              "This session does not belong to your active shift",
              403,
            );
          }

          /* ---------------------------------------------------------------- */
          /* PRODUCT                                                           */
          /* ---------------------------------------------------------------- */

          const [
            product,
          ] =
            await tx
              .select({
                id:
                  products.id,

                name:
                  products.name,

                price:
                  products.price,

                active:
                  products.active,
              })
              .from(
                products,
              )
              .where(
                eq(
                  products.id,
                  productId,
                ),
              )
              .limit(1);

          if (!product) {
            throw new ItemsError(
              "Product not found",
              404,
            );
          }

          if (
            !product.active
          ) {
            throw new ItemsError(
              "Product is not active",
              409,
            );
          }

          const unitPrice =
            Number(
              product.price,
            );

          if (
            !Number.isFinite(
              unitPrice,
            ) ||
            unitPrice <
              0
          ) {
            throw new ItemsError(
              "Product has an invalid price",
              500,
            );
          }

          /* ---------------------------------------------------------------- */
          /* INSERT SNAPSHOT                                                   */
          /* ---------------------------------------------------------------- */

          const [
            item,
          ] =
            await tx
              .insert(
                bookingItems,
              )
              .values({
                bookingId,

                productId:
                  product.id,

                /*
                 * Snapshot both name and price.
                 *
                 * Future product edits cannot change this session's bill.
                 */
                nameSnapshot:
                  product.name,

                unitPrice:
                  product.price,

                quantity,
              })
              .returning({
                id:
                  bookingItems.id,

                name:
                  bookingItems.nameSnapshot,

                unitPrice:
                  bookingItems.unitPrice,

                quantity:
                  bookingItems.quantity,
              });

          if (!item) {
            throw new ItemsError(
              "Could not add product",
              500,
            );
          }

          return item;
        },
      );

    return NextResponse.json({
      ok: true,

      item: result,
    });
  } catch (
    error
  ) {
    if (
      error instanceof
      ItemsError
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

    console.error(
      "[booking items POST] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to add product to session",
      },
      {
        status: 500,
      },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* PATCH - UPDATE ITEM QUANTITY                                               */
/* -------------------------------------------------------------------------- */

export async function PATCH(
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

    const bookingId =
      parseBookingId(id);

    if (!bookingId) {
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

    let body: {
      itemId?: number;
      quantity?: number;
    };

    try {
      body =
        (await req.json()) as {
          itemId?: number;
          quantity?: number;
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

    const itemId =
      parsePositiveInteger(
        body.itemId,
      );

    const quantity =
      parsePositiveInteger(
        body.quantity,
      );

    if (!itemId) {
      return NextResponse.json(
        {
          error:
            "itemId required",
        },
        {
          status: 400,
        },
      );
    }

    if (!quantity) {
      return NextResponse.json(
        {
          error:
            "quantity must be a positive integer",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      await db.transaction(
        async (
          tx,
        ) => {
          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                29006,
                ${bookingId}
              )
            `,
          );

          /* ---------------------------------------------------------------- */
          /* BOOKING                                                           */
          /* ---------------------------------------------------------------- */

          const [
            booking,
          ] =
            await tx
              .select({
                id:
                  bookings.id,

                status:
                  bookings.status,

                shiftId:
                  bookings.shiftId,
              })
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
            throw new ItemsError(
              "Session not found",
              404,
            );
          }

          if (
            booking.status !==
            "active"
          ) {
            throw new ItemsError(
              "Session is not active",
              409,
            );
          }

          if (
            booking.shiftId !==
            shift.id
          ) {
            throw new ItemsError(
              "This session does not belong to your active shift",
              403,
            );
          }

          /* ---------------------------------------------------------------- */
          /* ITEM                                                              */
          /* ---------------------------------------------------------------- */

          const [
            item,
          ] =
            await tx
              .select({
                id:
                  bookingItems.id,

                productId:
                  bookingItems.productId,

                name:
                  bookingItems.nameSnapshot,

                unitPrice:
                  bookingItems.unitPrice,

                quantity:
                  bookingItems.quantity,
              })
              .from(
                bookingItems,
              )
              .where(
                and(
                  eq(
                    bookingItems.id,
                    itemId,
                  ),

                  eq(
                    bookingItems.bookingId,
                    bookingId,
                  ),
                ),
              )
              .limit(1);

          if (!item) {
            throw new ItemsError(
              "Session item not found",
              404,
            );
          }

          /*
           * Keep the item price/name snapshot unchanged.
           * Only quantity is mutable.
           */
          const [
            updated,
          ] =
            await tx
              .update(
                bookingItems,
              )
              .set({
                quantity,
              })
              .where(
                and(
                  eq(
                    bookingItems.id,
                    itemId,
                  ),

                  eq(
                    bookingItems.bookingId,
                    bookingId,
                  ),
                ),
              )
              .returning({
                id:
                  bookingItems.id,

                name:
                  bookingItems.nameSnapshot,

                unitPrice:
                  bookingItems.unitPrice,

                quantity:
                  bookingItems.quantity,
              });

          if (!updated) {
            throw new ItemsError(
              "Could not update session item",
              500,
            );
          }

          return updated;
        },
      );

    return NextResponse.json({
      ok: true,

      item: result,
    });
  } catch (
    error
  ) {
    if (
      error instanceof
      ItemsError
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

    console.error(
      "[booking items PATCH] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to update session item",
      },
      {
        status: 500,
      },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* DELETE - REMOVE ITEM                                                       */
/* -------------------------------------------------------------------------- */

export async function DELETE(
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

    const bookingId =
      parseBookingId(id);

    if (!bookingId) {
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

    const url =
      new URL(
        req.url,
      );

    const itemId =
      parsePositiveInteger(
        url.searchParams.get(
          "itemId",
        ),
      );

    if (!itemId) {
      return NextResponse.json(
        {
          error:
            "itemId required",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      await db.transaction(
        async (
          tx,
        ) => {
          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                29006,
                ${bookingId}
              )
            `,
          );

          /* ---------------------------------------------------------------- */
          /* BOOKING                                                           */
          /* ---------------------------------------------------------------- */

          const [
            booking,
          ] =
            await tx
              .select({
                id:
                  bookings.id,

                status:
                  bookings.status,

                shiftId:
                  bookings.shiftId,
              })
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
            throw new ItemsError(
              "Session not found",
              404,
            );
          }

          if (
            booking.status !==
            "active"
          ) {
            throw new ItemsError(
              "Session is not active",
              409,
            );
          }

          if (
            booking.shiftId !==
            shift.id
          ) {
            throw new ItemsError(
              "This session does not belong to your active shift",
              403,
            );
          }

          /* ---------------------------------------------------------------- */
          /* DELETE ITEM                                                       */
          /* ---------------------------------------------------------------- */

          const deleted =
            await tx
              .delete(
                bookingItems,
              )
              .where(
                and(
                  eq(
                    bookingItems.id,
                    itemId,
                  ),

                  eq(
                    bookingItems.bookingId,
                    bookingId,
                  ),
                ),
              )
              .returning({
                id:
                  bookingItems.id,
              });

          /*
           * Idempotent DELETE:
           *
           * If the item is already gone, there is nothing left to remove.
           * The session itself was still validated above.
           */
          return {
            removed:
              deleted.length >
              0,
          };
        },
      );

    return NextResponse.json({
      ok: true,

      removed:
        result.removed,
    });
  } catch (
    error
  ) {
    if (
      error instanceof
      ItemsError
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

    console.error(
      "[booking items DELETE] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to remove session item",
      },
      {
        status: 500,
      },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* ERROR                                                                      */
/* -------------------------------------------------------------------------- */

class ItemsError extends Error {
  status: number;

  constructor(
    message: string,
    status: number,
  ) {
    super(message);

    this.name =
      "ItemsError";

    this.status =
      status;
  }
}