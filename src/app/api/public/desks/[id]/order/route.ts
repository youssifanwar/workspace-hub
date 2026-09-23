import { NextResponse } from "next/server";

import crypto from "crypto";

import { db } from "@/db";

import {
  desks,
  products,
  bookings,
  customers,
  bookingItems,
  orderTickets,
  orderRequests,
} from "@/db/schema";

import {
  and,
  eq,
  inArray,
  sql,
} from "drizzle-orm";

import { publish } from "@/lib/events";

export const dynamic =
  "force-dynamic";

const CUSTOMER_COOKIE =
  "wsh_customer_session";

type LineInput = {
  productId: number;
  quantity: number;
  note?: string;
};

type RequestBody = {
  requestId?: string;

  items?: LineInput[];

  customerNote?: string;
};

type OrderResult = {
  ticketId: number;

  ticketNumber: number;

  total: number;

  itemCount: number;

  createdAt: Date;

  duplicate: boolean;

  bookingId: number;
};

class OrderError extends Error {
  status: number;

  constructor(
    message: string,
    status: number,
  ) {
    super(message);

    this.name =
      "OrderError";

    this.status =
      status;
  }
}

/* -------------------------------------------------------------------------- */
/* HELPERS                                                                    */
/* -------------------------------------------------------------------------- */

function hashAccessToken(
  token: string,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(token)
    .digest("hex");
}

function getCookieValue(
  cookieHeader: string | null,
  name: string,
) {
  if (!cookieHeader) {
    return null;
  }

  const parts =
    cookieHeader
      .split(";")
      .map(
        (part) =>
          part.trim(),
      );

  const target =
    `${name}=`;

  for (
    const part of parts
  ) {
    if (
      part.startsWith(
        target,
      )
    ) {
      try {
        return decodeURIComponent(
          part.slice(
            target.length,
          ),
        );
      } catch {
        return null;
      }
    }
  }

  return null;
}

function isPositiveInteger(
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

function normalizeRequestId(
  value: unknown,
): string {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  return value.trim();
}

function normalizeNote(
  value: unknown,
  maxLength: number,
) {
  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  return (
    value
      .trim()
      .slice(
        0,
        maxLength,
      ) || null
  );
}

function parsePrice(
  value: unknown,
): number {
  const price =
    Number(value);

  if (
    !Number.isFinite(
      price,
    ) ||
    price < 0
  ) {
    throw new OrderError(
      "Product has an invalid price",
      500,
    );
  }

  return price;
}

/* -------------------------------------------------------------------------- */
/* POST                                                                       */
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
  /*
   * ------------------------------------------------------------------------
   * PHYSICAL LOCATION / QR ID
   * ------------------------------------------------------------------------
   */

  const { id } =
    await params;

  const deskId =
    Number(id);

  if (
    !Number.isInteger(
      deskId,
    ) ||
    deskId <= 0
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid desk id",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * ------------------------------------------------------------------------
   * REQUEST BODY
   * ------------------------------------------------------------------------
   */

  const body =
    (await req
      .json()
      .catch(
        () => null,
      )) as RequestBody | null;

  if (!body) {
    return NextResponse.json(
      {
        error:
          "Invalid request body",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * ------------------------------------------------------------------------
   * REQUEST ID
   * ------------------------------------------------------------------------
   */

  const requestId =
    normalizeRequestId(
      body.requestId,
    );

  if (!requestId) {
    return NextResponse.json(
      {
        error:
          "Missing requestId. Please refresh the menu and try again.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    requestId.length >
    128
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid requestId",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * ------------------------------------------------------------------------
   * ITEMS
   * ------------------------------------------------------------------------
   */

  if (
    !Array.isArray(
      body.items,
    ) ||
    body.items.length ===
      0
  ) {
    return NextResponse.json(
      {
        error:
          "Empty order",
      },
      {
        status: 400,
      },
    );
  }

  const items =
    body.items;

  if (
    items.length >
    50
  ) {
    return NextResponse.json(
      {
        error:
          "Too many items in one order",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * ------------------------------------------------------------------------
   * CUSTOMER COOKIE
   * ------------------------------------------------------------------------
   */

  const rawToken =
    getCookieValue(
      req.headers.get(
        "cookie",
      ),
      CUSTOMER_COOKIE,
    );

  if (!rawToken) {
    return NextResponse.json(
      {
        error:
          "No active customer session. Please connect your phone first.",
      },
      {
        status: 401,
      },
    );
  }

  const tokenHash =
    hashAccessToken(
      rawToken,
    );

  /*
   * ------------------------------------------------------------------------
   * TRANSACTION
   * ------------------------------------------------------------------------
   */

  let result:
    | OrderResult
    | undefined;

  try {
    result =
      await db.transaction(
        async (
          tx,
        ) => {
          /*
           * ---------------------------------------------------------------
           * LOCK REQUEST ID
           * ---------------------------------------------------------------
           *
           * Same requestId can be submitted several times by the browser,
           * phone, bad network retry, or double tap.
           *
           * Every operation for the same requestId is serialized.
           */
          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                hashtext(${requestId})
              )
            `,
          );

          /*
           * ---------------------------------------------------------------
           * VERIFY PHYSICAL LOCATION
           * ---------------------------------------------------------------
           */

          const [
            desk,
          ] =
            await tx
              .select({
                id:
                  desks.id,

                name:
                  desks.name,

                active:
                  desks.active,
              })
              .from(
                desks,
              )
              .where(
                and(
                  eq(
                    desks.id,
                    deskId,
                  ),

                  eq(
                    desks.active,
                    true,
                  ),
                ),
              )
              .limit(1);

          if (!desk) {
            throw new OrderError(
              "Desk not found",
              404,
            );
          }

          /*
           * ---------------------------------------------------------------
           * VERIFY ACTIVE CUSTOMER SESSION
           * ---------------------------------------------------------------
           *
           * We verify the session AGAIN inside the transaction.
           *
           * The earlier versions checked it before entering the transaction,
           * which leaves a race window where the staff could close the
           * session between the check and creation of the order.
           */
          const [
            booking,
          ] =
            await tx
              .select({
                id:
                  bookings.id,

                customerId:
                  bookings.customerId,

                customerName:
                  customers.name,

                customerPhone:
                  customers.phone,

                status:
                  bookings.status,
              })
              .from(
                bookings,
              )
              .innerJoin(
                customers,
                eq(
                  customers.id,
                  bookings.customerId,
                ),
              )
              .where(
                and(
                  eq(
                    bookings.accessTokenHash,
                    tokenHash,
                  ),

                  eq(
                    bookings.status,
                    "active",
                  ),
                ),
              )
              .limit(1);

          if (!booking) {
            throw new OrderError(
              "Your customer session is no longer active. Please ask the staff for a new session.",
              401,
            );
          }

          /*
           * ---------------------------------------------------------------
           * LOCK CUSTOMER SESSION
           * ---------------------------------------------------------------
           *
           * The same booking is also protected against simultaneous
           * checkout/cancellation/order operations.
           */
          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                29007,
                ${booking.id}
              )
            `,
          );

          /*
           * Re-check status after acquiring the lock.
           */
          const [
            lockedBooking,
          ] =
            await tx
              .select({
                id:
                  bookings.id,

                customerId:
                  bookings.customerId,

                customerName:
                  customers.name,

                status:
                  bookings.status,
              })
              .from(
                bookings,
              )
              .innerJoin(
                customers,
                eq(
                  customers.id,
                  bookings.customerId,
                ),
              )
              .where(
                and(
                  eq(
                    bookings.id,
                    booking.id,
                  ),

                  eq(
                    bookings.accessTokenHash,
                    tokenHash,
                  ),
                ),
              )
              .limit(1);

          if (
            !lockedBooking ||
            lockedBooking.status !==
              "active"
          ) {
            throw new OrderError(
              "Your customer session is no longer active. Please ask the staff for a new session.",
              401,
            );
          }

          /*
           * ---------------------------------------------------------------
           * CHECK EXISTING REQUEST
           * ---------------------------------------------------------------
           */

          const [
            existingRequest,
          ] =
            await tx
              .select({
                requestId:
                  orderRequests.requestId,

                ticketId:
                  orderRequests.ticketId,
              })
              .from(
                orderRequests,
              )
              .where(
                eq(
                  orderRequests.requestId,
                  requestId,
                ),
              )
              .limit(1);

          if (
            existingRequest
          ) {
            /*
             * Load the ticket and make sure the original request belongs
             * to the SAME customer session.
             *
             * A requestId must never allow one customer session to retrieve
             * another customer's ticket.
             */
            const [
              existingTicket,
            ] =
              await tx
                .select({
                  id:
                    orderTickets.id,

                  ticketNumber:
                    orderTickets.ticketNumber,

                  bookingId:
                    orderTickets.bookingId,

                  createdAt:
                    orderTickets.createdAt,
                })
                .from(
                  orderTickets,
                )
                .where(
                  eq(
                    orderTickets.id,
                    existingRequest.ticketId,
                  ),
                )
                .limit(1);

            if (
              !existingTicket
            ) {
              /*
               * Corrupted request mapping.
               *
               * Since this request is holding the requestId lock, it is
               * safe to remove the orphan mapping and continue.
               */
              await tx
                .delete(
                  orderRequests,
                )
                .where(
                  eq(
                    orderRequests.requestId,
                    requestId,
                  ),
                );
            } else {
              if (
                existingTicket.bookingId !==
                lockedBooking.id
              ) {
                throw new OrderError(
                  "This requestId is already used by another customer session.",
                  409,
                );
              }

              const existingItems =
                await tx
                  .select({
                    quantity:
                      bookingItems.quantity,

                    unitPrice:
                      bookingItems.unitPrice,
                  })
                  .from(
                    bookingItems,
                  )
                  .where(
                    eq(
                      bookingItems.ticketId,
                      existingTicket.id,
                    ),
                  );

              const existingTotal =
                existingItems.reduce(
                  (
                    sum,
                    item,
                  ) =>
                    sum +
                    item.quantity *
                      parsePrice(
                        item.unitPrice,
                      ),
                  0,
                );

              const itemCount =
                existingItems.reduce(
                  (
                    sum,
                    item,
                  ) =>
                    sum +
                    item.quantity,
                  0,
                );

              return {
                ticketId:
                  existingTicket.id,

                ticketNumber:
                  existingTicket.ticketNumber,

                total:
                  existingTotal,

                itemCount,

                createdAt:
                  existingTicket.createdAt,

                duplicate:
                  true,

                bookingId:
                  lockedBooking.id,
              };
            }
          }

          /*
           * ---------------------------------------------------------------
           * VALIDATE INPUT LINES BEFORE ANY INSERT
           * ---------------------------------------------------------------
           */

          const normalizedItems =
            items.map(
              (
                line,
                index,
              ) => {
                const productId =
                  Number(
                    line?.productId,
                  );

                const quantity =
                  Number(
                    line?.quantity,
                  );

                if (
                  !Number.isInteger(
                    productId,
                  ) ||
                  productId <=
                    0
                ) {
                  throw new OrderError(
                    `Invalid product at line ${index + 1}`,
                    400,
                  );
                }

                if (
                  !Number.isInteger(
                    quantity,
                  ) ||
                  quantity <
                    1 ||
                  quantity >
                    50
                ) {
                  throw new OrderError(
                    `Invalid quantity for product ${productId}`,
                    400,
                  );
                }

                const note =
                  normalizeNote(
                    line?.note,
                    500,
                  );

                return {
                  productId,

                  quantity,

                  note,
                };
              },
            );

          /*
           * ---------------------------------------------------------------
           * PRODUCT IDS
           * ---------------------------------------------------------------
           */

          const productIds =
            [
              ...new Set(
                normalizedItems.map(
                  (
                    line,
                  ) =>
                    line.productId,
                ),
              ),
            ];

          if (
            productIds.length ===
            0
          ) {
            throw new OrderError(
              "No valid products in order",
              400,
            );
          }

          /*
           * ---------------------------------------------------------------
           * LOAD PRODUCTS
           * ---------------------------------------------------------------
           */

          const productRows =
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

                stockQuantity:
                  products.stockQuantity,
              })
              .from(
                products,
              )
              .where(
                inArray(
                  products.id,
                  productIds,
                ),
              );

          const productMap =
            new Map(
              productRows.map(
                (
                  product,
                ) => [
                  product.id,
                  product,
                ],
              ),
            );

          /*
           * ---------------------------------------------------------------
           * AGGREGATE REQUESTED STOCK
           * ---------------------------------------------------------------
           *
           * A client could technically send the same product more than once
           * in the same request. Stock validation must use the combined
           * quantity so one order cannot bypass the limit by splitting lines.
           */

          const requestedQuantityByProductId =
            new Map<number, number>();

          for (
            const line of normalizedItems
          ) {
            requestedQuantityByProductId.set(
              line.productId,
              (requestedQuantityByProductId.get(
                line.productId,
              ) ?? 0) + line.quantity,
            );
          }

          /*
           * ---------------------------------------------------------------
           * VALIDATE PRODUCTS + STOCK
           * ---------------------------------------------------------------
           */

          for (
            const line of normalizedItems
          ) {
            const product =
              productMap.get(
                line.productId,
              );

            if (!product) {
              throw new OrderError(
                `Product ${line.productId} is unavailable`,
                400,
              );
            }

            if (
              !product.active
            ) {
              throw new OrderError(
                `Product ${line.productId} is unavailable`,
                400,
              );
            }

            parsePrice(
              product.price,
            );

            const requestedQuantity =
              requestedQuantityByProductId.get(
                line.productId,
              ) ?? 0;

            if (
              requestedQuantity >
              product.stockQuantity
            ) {
              throw new OrderError(
                `${product.name} is out of stock or does not have enough stock. Available: ${product.stockQuantity}.`,
                409,
              );
            }
          }

          /*
           * ---------------------------------------------------------------
           * ATOMIC STOCK DECREMENT
           * ---------------------------------------------------------------
           *
           * The WHERE clause is the concurrency guard. If two customers order
           * at the same time, PostgreSQL will only let the update succeed while
           * enough stock remains. No order can push stock below zero.
           */

          for (
            const productId of productIds
          ) {
            const product =
              productMap.get(
                productId,
              );

            if (!product) {
              throw new OrderError(
                `Product ${productId} is unavailable`,
                400,
              );
            }

            const requestedQuantity =
              requestedQuantityByProductId.get(
                productId,
              ) ?? 0;

            const [updatedProduct] =
              await tx
                .update(products)
                .set({
                  stockQuantity:
                    sql`${products.stockQuantity} - ${requestedQuantity}`,
                })
                .where(
                  and(
                    eq(
                      products.id,
                      productId,
                    ),
                    eq(
                      products.active,
                      true,
                    ),
                    sql`${products.stockQuantity} >= ${requestedQuantity}`,
                  ),
                )
                .returning({
                  id: products.id,
                  stockQuantity:
                    products.stockQuantity,
                });

            if (!updatedProduct) {
              const [currentProduct] =
                await tx
                  .select({
                    name: products.name,
                    stockQuantity:
                      products.stockQuantity,
                    active:
                      products.active,
                  })
                  .from(products)
                  .where(
                    eq(
                      products.id,
                      productId,
                    ),
                  )
                  .limit(1);

              if (
                !currentProduct ||
                !currentProduct.active
              ) {
                throw new OrderError(
                  `Product ${productId} is unavailable`,
                  400,
                );
              }

              throw new OrderError(
                `${currentProduct.name} is out of stock or does not have enough stock. Available: ${currentProduct.stockQuantity}.`,
                409,
              );
            }
          }

          /*
           * ---------------------------------------------------------------
           * DAILY TICKET NUMBER LOCK
           * ---------------------------------------------------------------
           *
           * All ticket-number generation is serialized.
           */
          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                987654321
              )
            `,
          );

          /*
           * ---------------------------------------------------------------
           * GET TODAY'S MAX TICKET
           * ---------------------------------------------------------------
           */

          const [
            ticketRow,
          ] =
            await tx
              .select({
                max:
                  sql<number>`
                    COALESCE(
                      MAX(
                        ${orderTickets.ticketNumber}
                      ),
                      0
                    )::int
                  `,
              })
              .from(
                orderTickets,
              )
              .where(
                sql`
                  DATE_TRUNC(
                    'day',
                    ${orderTickets.createdAt}
                  ) =
                  DATE_TRUNC(
                    'day',
                    NOW()
                  )
                `,
              );

          const ticketNumber =
            Number(
              ticketRow?.max ??
                0,
            ) + 1;

          /*
           * ---------------------------------------------------------------
           * CREATE TICKET
           * ---------------------------------------------------------------
           *
           * bookingId = customer session
           * deskId    = physical location scanned by QR
           */
          const [
            ticket,
          ] =
            await tx
              .insert(
                orderTickets,
              )
              .values({
                ticketNumber,

                bookingId:
                  lockedBooking.id,

                deskId,

                source:
                  "qr",

                status:
                  "pending",

                customerNote:
                  normalizeNote(
                    body.customerNote,
                    1000,
                  ),
              })
              .returning({
                id:
                  orderTickets.id,

                ticketNumber:
                  orderTickets.ticketNumber,

                createdAt:
                  orderTickets.createdAt,

                bookingId:
                  orderTickets.bookingId,
              });

          if (!ticket) {
            throw new OrderError(
              "Failed to create order ticket",
              500,
            );
          }

          /*
           * ---------------------------------------------------------------
           * BUILD ITEM SNAPSHOTS
           * ---------------------------------------------------------------
           */

          let total = 0;

          const rowsToInsert: Array<{
            bookingId: number;

            ticketId: number;

            productId: number;

            nameSnapshot: string;

            unitPrice: string;

            quantity: number;

            source: "qr";

            itemNote:
              | string
              | null;
          }> = [];

          for (
            const line of normalizedItems
          ) {
            const product =
              productMap.get(
                line.productId,
              );

            if (!product) {
              throw new OrderError(
                "Product validation failed",
                500,
              );
            }

            const price =
              parsePrice(
                product.price,
              );

            rowsToInsert.push({
              bookingId:
                lockedBooking.id,

              ticketId:
                ticket.id,

              productId:
                product.id,

              /*
               * Snapshot name and price.
               *
               * Future product edits cannot change this existing order.
               */
              nameSnapshot:
                product.name,

              unitPrice:
                product.price,

              quantity:
                line.quantity,

              source:
                "qr",

              itemNote:
                line.note,
            });

            total +=
              line.quantity *
              price;
          }

          if (
            rowsToInsert.length ===
            0
          ) {
            throw new OrderError(
              "No valid items in order",
              400,
            );
          }

          /*
           * ---------------------------------------------------------------
           * INSERT ITEMS
           * ---------------------------------------------------------------
           */

          await tx
            .insert(
              bookingItems,
            )
            .values(
              rowsToInsert,
            );

          /*
           * ---------------------------------------------------------------
           * SAVE IDEMPOTENCY REQUEST
           * ---------------------------------------------------------------
           *
           * This is in the SAME transaction as the ticket/items.
           *
           * Therefore:
           * - ticket created + request saved
           * - OR nothing is saved
           */
          await tx
            .insert(
              orderRequests,
            )
            .values({
              requestId,

              ticketId:
                ticket.id,
            });

          /*
           * ---------------------------------------------------------------
           * RESULT
           * ---------------------------------------------------------------
           */

          return {
            ticketId:
              ticket.id,

            ticketNumber:
              ticket.ticketNumber,

            total,

            itemCount:
              rowsToInsert.reduce(
                (
                  sum,
                  row,
                ) =>
                  sum +
                  row.quantity,
                0,
              ),

            createdAt:
              ticket.createdAt,

            duplicate:
              false,

            bookingId:
              lockedBooking.id,
          };
        },
      );
  } catch (
    error
  ) {
    if (
      error instanceof
      OrderError
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

    const message =
      error instanceof
      Error
        ? error.message
        : "";

    /*
     * Unique constraint protection for a requestId that may have raced
     * with another request outside our expected lock path.
     */
    if (
      message
        .toLowerCase()
        .includes(
          "order_requests",
        ) &&
      message
        .toLowerCase()
        .includes(
          "unique",
        )
    ) {
      return NextResponse.json(
        {
          error:
            "This order request was already processed. Please refresh the menu.",
        },
        {
          status: 409,
        },
      );
    }

    console.error(
      "QR order failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Could not place order. Please try again.",
      },
      {
        status: 500,
      },
    );
  }

  /*
   * ------------------------------------------------------------------------
   * PUBLISH ONLY FOR NEW ORDER
   * ------------------------------------------------------------------------
   */

  if (
    result &&
    !result.duplicate
  ) {
    /*
     * We need the physical location and customer name for the event.
     *
     * Fetching after the transaction is safe here because the event is
     * informational only. The actual order has already committed.
     */
    const [
      eventContext,
    ] =
      await db
        .select({
          deskId:
            desks.id,

          deskName:
            desks.name,

          customerName:
            customers.name,
        })
        .from(
          orderTickets,
        )
        .innerJoin(
          desks,
          eq(
            desks.id,
            orderTickets.deskId,
          ),
        )
        .innerJoin(
          bookings,
          eq(
            bookings.id,
            orderTickets.bookingId,
          ),
        )
        .innerJoin(
          customers,
          eq(
            customers.id,
            bookings.customerId,
          ),
        )
        .where(
          eq(
            orderTickets.id,
            result.ticketId,
          ),
        )
        .limit(1);

    if (
      eventContext
    ) {
      publish({
        type:
          "new_order",

        ticketId:
          result.ticketId,

        ticketNumber:
          result.ticketNumber,

        bookingId:
          result.bookingId,

        /*
         * Physical location.
         */
        deskId:
          eventContext.deskId,

        deskName:
          eventContext.deskName,

        customerName:
          eventContext.customerName,

        itemCount:
          result.itemCount,

        total:
          result.total,

        createdAt:
          result.createdAt.toISOString(),
      });
    }
  }

  /*
   * ------------------------------------------------------------------------
   * RESPONSE
   * ------------------------------------------------------------------------
   */

  return NextResponse.json({
    ok: true,

    duplicate:
      result.duplicate,

    ticketId:
      result.ticketId,

    ticketNumber:
      result.ticketNumber,

    total:
      result.total,
  });
}