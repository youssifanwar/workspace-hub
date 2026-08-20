import { NextResponse } from "next/server";
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

export const dynamic = "force-dynamic";

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
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ---------------------------------------------------------------------------
  // DESK ID
  // ---------------------------------------------------------------------------

  const { id } = await params;
  const deskId = Number(id);

  if (
    !Number.isInteger(deskId) ||
    deskId <= 0
  ) {
    return NextResponse.json(
      {
        error: "Invalid desk id",
      },
      {
        status: 400,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // REQUEST BODY
  // ---------------------------------------------------------------------------

  const body = (await req
    .json()
    .catch(() => null)) as RequestBody | null;

  if (!body) {
    return NextResponse.json(
      {
        error: "Invalid request body",
      },
      {
        status: 400,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // REQUEST ID
  // ---------------------------------------------------------------------------

  const requestId =
    typeof body.requestId === "string"
      ? body.requestId.trim()
      : "";

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

  if (requestId.length > 128) {
    return NextResponse.json(
      {
        error: "Invalid requestId",
      },
      {
        status: 400,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // ITEMS
  //
  // Make a non-optional local variable after validation.
  // This fixes the TypeScript "possibly undefined" error.
  // ---------------------------------------------------------------------------

  if (
    !Array.isArray(body.items) ||
    body.items.length === 0
  ) {
    return NextResponse.json(
      {
        error: "Empty order",
      },
      {
        status: 400,
      },
    );
  }

  const items = body.items;

  if (items.length > 50) {
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

  // ---------------------------------------------------------------------------
  // FIND DESK
  // ---------------------------------------------------------------------------

  const [desk] = await db
    .select({
      id: desks.id,
      name: desks.name,
      active: desks.active,
    })
    .from(desks)
    .where(
      and(
        eq(desks.id, deskId),
        eq(desks.active, true),
      ),
    )
    .limit(1);

  if (!desk) {
    return NextResponse.json(
      {
        error: "Desk not found",
      },
      {
        status: 404,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // FIND ACTIVE BOOKING
  // ---------------------------------------------------------------------------

  const [booking] = await db
    .select({
      id: bookings.id,
      customerName: customers.name,
    })
    .from(bookings)
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
          bookings.deskId,
          deskId,
        ),
        eq(
          bookings.status,
          "active",
        ),
      ),
    )
    .limit(1);

  if (!booking) {
    return NextResponse.json(
      {
        error:
          "This desk has no active session. Please ask the staff to check you in first.",
      },
      {
        status: 400,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // TRANSACTION
  // ---------------------------------------------------------------------------

  let result: OrderResult;

  try {
    result = await db.transaction(
      async (tx) => {
        // ---------------------------------------------------------------------
        // LOCK THIS REQUEST ID
        //
        // Prevents the exact same request from being processed twice at
        // the same time.
        // ---------------------------------------------------------------------

        await tx.execute(
          sql`
            SELECT pg_advisory_xact_lock(
              hashtext(${requestId})
            )
          `,
        );

        // ---------------------------------------------------------------------
        // CHECK IF REQUEST ALREADY EXISTS
        // ---------------------------------------------------------------------

        const [
          existingRequest,
        ] = await tx
          .select({
            requestId:
              orderRequests.requestId,
            ticketId:
              orderRequests.ticketId,
          })
          .from(orderRequests)
          .where(
            eq(
              orderRequests.requestId,
              requestId,
            ),
          )
          .limit(1);

        if (existingRequest) {
          // ---------------------------------------------------------------
          // RETURN EXISTING TICKET
          // ---------------------------------------------------------------

          const [
            existingTicket,
          ] = await tx
            .select({
              id: orderTickets.id,
              ticketNumber:
                orderTickets.ticketNumber,
              createdAt:
                orderTickets.createdAt,
            })
            .from(orderTickets)
            .where(
              eq(
                orderTickets.id,
                existingRequest.ticketId,
              ),
            )
            .limit(1);

          if (existingTicket) {
            const existingItems =
              await tx
                .select({
                  quantity:
                    bookingItems.quantity,
                  unitPrice:
                    bookingItems.unitPrice,
                })
                .from(bookingItems)
                .where(
                  eq(
                    bookingItems.ticketId,
                    existingTicket.id,
                  ),
                );

            const existingTotal =
              existingItems.reduce(
                (sum, item) =>
                  sum +
                  item.quantity *
                    parseFloat(
                      item.unitPrice,
                    ),
                0,
              );

            const itemCount =
              existingItems.reduce(
                (sum, item) =>
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

              duplicate: true,
            };
          }

          // Should only happen if data was manually corrupted.
          await tx
            .delete(orderRequests)
            .where(
              eq(
                orderRequests.requestId,
                requestId,
              ),
            );
        }

        // ---------------------------------------------------------------------
        // PRODUCT IDS
        // ---------------------------------------------------------------------

        const productIds = [
          ...new Set(
            items
              .map((line) =>
                Number(
                  line.productId,
                ),
              )
              .filter(
                (productId) =>
                  Number.isInteger(
                    productId,
                  ) &&
                  productId > 0,
              ),
          ),
        ];

        if (productIds.length === 0) {
          throw new Error(
            "No valid products in order",
          );
        }

        // ---------------------------------------------------------------------
        // LOAD PRODUCTS
        // ---------------------------------------------------------------------

        const productRows =
          await tx
            .select()
            .from(products)
            .where(
              inArray(
                products.id,
                productIds,
              ),
            );

        const productMap =
          new Map(
            productRows.map(
              (product) => [
                product.id,
                product,
              ],
            ),
          );

        // ---------------------------------------------------------------------
        // VALIDATE PRODUCTS + QUANTITIES
        // ---------------------------------------------------------------------

        for (const line of items) {
          const productId =
            Number(
              line.productId,
            );

          const product =
            productMap.get(
              productId,
            );

          if (
            !product ||
            !product.active
          ) {
            throw new Error(
              `Product ${productId} is unavailable`,
            );
          }

          const quantity =
            Number(
              line.quantity,
            );

          if (
            !Number.isFinite(
              quantity,
            ) ||
            !Number.isInteger(
              quantity,
            ) ||
            quantity < 1 ||
            quantity > 50
          ) {
            throw new Error(
              `Invalid quantity for product ${productId}`,
            );
          }

          if (
            typeof line.note ===
              "string" &&
            line.note.length > 500
          ) {
            throw new Error(
              `Note is too long for product ${productId}`,
            );
          }
        }

        // ---------------------------------------------------------------------
        // LOCK DAILY TICKET NUMBER
        //
        // Prevents two different phones from generating the same ticket number.
        // ---------------------------------------------------------------------

        await tx.execute(
          sql`
            SELECT pg_advisory_xact_lock(
              987654321
            )
          `,
        );

        // ---------------------------------------------------------------------
        // GET TODAY'S MAX TICKET
        // ---------------------------------------------------------------------

        const [row] =
          await tx
            .select({
              max: sql<number>`
                COALESCE(
                  MAX(
                    ${orderTickets.ticketNumber}
                  ),
                  0
                )::int
              `,
            })
            .from(orderTickets)
            .where(
              sql`
                DATE_TRUNC(
                  'day',
                  ${orderTickets.createdAt}
                )
                =
                DATE_TRUNC(
                  'day',
                  NOW()
                )
              `,
            );

        const ticketNumber =
          (row?.max || 0) + 1;

        // ---------------------------------------------------------------------
        // INSERT TICKET
        // ---------------------------------------------------------------------

        const [
          ticket,
        ] = await tx
          .insert(orderTickets)
          .values({
            ticketNumber,

            bookingId:
              booking.id,

            deskId,

            source: "qr",

            status: "pending",

            customerNote:
              typeof body.customerNote ===
              "string"
                ? body.customerNote
                    .trim()
                    .slice(
                      0,
                      1000,
                    ) || null
                : null,
          })
          .returning();

        if (!ticket) {
          throw new Error(
            "Failed to create order ticket",
          );
        }

        // ---------------------------------------------------------------------
        // BUILD ITEMS
        // ---------------------------------------------------------------------

        let total = 0;

        const rowsToInsert: Array<{
          bookingId: number;
          ticketId: number;
          productId: number;
          nameSnapshot: string;
          unitPrice: string;
          quantity: number;
          source: "qr";
          itemNote: string | null;
        }> = [];

        for (const line of items) {
          const product =
            productMap.get(
              Number(
                line.productId,
              ),
            );

          if (!product) {
            throw new Error(
              "Product validation failed",
            );
          }

          const quantity =
            Number(
              line.quantity,
            );

          const itemNote =
            typeof line.note ===
              "string"
              ? line.note
                  .trim()
                  .slice(
                    0,
                    500,
                  ) || null
              : null;

          rowsToInsert.push({
            bookingId:
              booking.id,

            ticketId:
              ticket.id,

            productId:
              product.id,

            nameSnapshot:
              product.name,

            unitPrice:
              product.price,

            quantity,

            source: "qr",

            itemNote,
          });

          total +=
            quantity *
            parseFloat(
              product.price,
            );
        }

        if (
          rowsToInsert.length ===
          0
        ) {
          throw new Error(
            "No valid items in order",
          );
        }

        // ---------------------------------------------------------------------
        // INSERT ITEMS
        // ---------------------------------------------------------------------

        await tx
          .insert(bookingItems)
          .values(
            rowsToInsert,
          );

        // ---------------------------------------------------------------------
        // SAVE REQUEST ID
        // ---------------------------------------------------------------------

        await tx
          .insert(orderRequests)
          .values({
            requestId,

            ticketId:
              ticket.id,
          });

        // ---------------------------------------------------------------------
        // RETURN RESULT
        // ---------------------------------------------------------------------

        return {
          ticketId:
            ticket.id,

          ticketNumber:
            ticket.ticketNumber,

          total,

          itemCount:
            rowsToInsert.reduce(
              (sum, row) =>
                sum +
                row.quantity,
              0,
            ),

          createdAt:
            ticket.createdAt,

          duplicate: false,
        };
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "";

    // -------------------------------------------------------------------------
    // EXPECTED VALIDATION ERRORS
    // -------------------------------------------------------------------------

    if (
      message.startsWith(
        "Product ",
      ) ||
      message.startsWith(
        "Invalid quantity",
      ) ||
      message.startsWith(
        "Note is too long",
      ) ||
      message ===
        "No valid products in order" ||
      message ===
        "No valid items in order"
    ) {
      return NextResponse.json(
        {
          error: message,
        },
        {
          status: 400,
        },
      );
    }

    // -------------------------------------------------------------------------
    // DATABASE / SERVER ERROR
    // -------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // PUBLISH ONLY FOR A NEW ORDER
  // ---------------------------------------------------------------------------

  if (!result.duplicate) {
    publish({
      type: "new_order",

      ticketId:
        result.ticketId,

      ticketNumber:
        result.ticketNumber,

      bookingId:
        booking.id,

      deskId,

      deskName:
        desk.name,

      customerName:
        booking.customerName,

      itemCount:
        result.itemCount,

      total:
        result.total,

      createdAt:
        result.createdAt.toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // RESPONSE
  // ---------------------------------------------------------------------------

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