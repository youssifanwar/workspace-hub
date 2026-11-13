import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  orderTickets,
  bookings,
  customers,
  desks,
  bookingItems,
  products,
  auditLogs,
} from "@/db/schema";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export const dynamic = "force-dynamic";

const VALID_STATUSES = [
  "pending",
  "printed",
  "served",
  "cancelled",
] as const;

type TicketStatus = (typeof VALID_STATUSES)[number];

function isTicketStatus(value: unknown): value is TicketStatus {
  return (
    typeof value === "string" &&
    (VALID_STATUSES as readonly string[]).includes(value)
  );
}

export async function GET(req: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const onlyPending =
    url.searchParams.get("pending") === "1";

  const where = onlyPending
    ? inArray(orderTickets.status, ["pending", "printed"])
    : undefined;

  const ticketRows = await db
    .select({
      id: orderTickets.id,
      ticketNumber: orderTickets.ticketNumber,
      status: orderTickets.status,
      source: orderTickets.source,
      customerNote: orderTickets.customerNote,
      printedAt: orderTickets.printedAt,
      servedAt: orderTickets.servedAt,
      createdAt: orderTickets.createdAt,
      bookingId: orderTickets.bookingId,
      deskId: orderTickets.deskId,
      deskName: desks.name,
      customerName: customers.name,
      customerPhone: customers.phone,
    })
    .from(orderTickets)
    .innerJoin(
      desks,
      eq(desks.id, orderTickets.deskId),
    )
    .innerJoin(
      bookings,
      eq(bookings.id, orderTickets.bookingId),
    )
    .innerJoin(
      customers,
      eq(customers.id, bookings.customerId),
    )
    .where(where)
    .orderBy(desc(orderTickets.createdAt))
    .limit(60);

  if (ticketRows.length === 0) {
    return NextResponse.json({ tickets: [] });
  }

  const ticketIds = ticketRows.map((ticket) => ticket.id);

  const items = await db
    .select()
    .from(bookingItems)
    .where(inArray(bookingItems.ticketId, ticketIds));

  const itemsByTicket =
    new Map<number, typeof items>();

  for (const item of items) {
    if (!item.ticketId) continue;

    const list = itemsByTicket.get(item.ticketId) || [];
    list.push(item);
    itemsByTicket.set(item.ticketId, list);
  }

  return NextResponse.json({
    tickets: ticketRows.map((ticket) => {
      const ticketItems = itemsByTicket.get(ticket.id) || [];
      const total = ticketItems.reduce(
        (sum, item) =>
          sum +
          item.quantity *
            parseFloat(item.unitPrice),
        0,
      );

      return {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        source: ticket.source,
        customerNote: ticket.customerNote,
        printedAt: ticket.printedAt,
        servedAt: ticket.servedAt,
        createdAt: ticket.createdAt,
        bookingId: ticket.bookingId,
        deskId: ticket.deskId,
        deskName: ticket.deskName,
        customerName: ticket.customerName,
        customerPhone: ticket.customerPhone,
        items: ticketItems.map((item) => ({
          id: item.id,
          name: item.nameSnapshot,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          note: item.itemNote,
        })),
        total,
      };
    }),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const activeShift = await getActiveShiftForUser(user.id);

  if (!activeShift) {
    return NextResponse.json(
      { error: "Open a shift before updating tickets" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const ticketId = Number(id);

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return NextResponse.json(
      { error: "Invalid ticket id" },
      { status: 400 },
    );
  }

  let body: {
    status?: unknown;
    markPrinted?: unknown;
  };

  try {
    body = (await req.json()) as {
      status?: unknown;
      markPrinted?: unknown;
    };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const [ticket] = await db
    .select({
      id: orderTickets.id,
      ticketNumber: orderTickets.ticketNumber,
      status: orderTickets.status,
      printedAt: orderTickets.printedAt,
      servedAt: orderTickets.servedAt,
      bookingId: orderTickets.bookingId,
      shiftId: bookings.shiftId,
      checkedOutAt: bookings.checkedOutAt,
    })
    .from(orderTickets)
    .innerJoin(bookings, eq(bookings.id, orderTickets.bookingId))
    .where(eq(orderTickets.id, ticketId))
    .limit(1);

  if (!ticket) {
    return NextResponse.json(
      { error: "Ticket not found" },
      { status: 404 },
    );
  }

  if (ticket.shiftId !== activeShift.id && ticket.checkedOutAt !== null) {
    return NextResponse.json(
      { error: "This ticket belongs to a closed session" },
      { status: 403 },
    );
  }

  const requestedStatus = body.status;
  const markPrinted = body.markPrinted === true;

  if (
    requestedStatus !== undefined &&
    !isTicketStatus(requestedStatus)
  ) {
    return NextResponse.json(
      { error: "Invalid ticket status" },
      { status: 400 },
    );
  }

  if (
    requestedStatus === "pending" &&
    ticket.status !== "pending"
  ) {
    return NextResponse.json(
      { error: "Tickets cannot be moved back to pending" },
      { status: 409 },
    );
  }

  if (
    (ticket.status === "served" ||
      ticket.status === "cancelled") &&
    requestedStatus !== undefined &&
    requestedStatus !== ticket.status
  ) {
    return NextResponse.json(
      { error: "Ticket is already closed" },
      { status: 409 },
    );
  }

  if (
    requestedStatus === "printed" &&
    ticket.status !== "pending" &&
    ticket.status !== "printed"
  ) {
    return NextResponse.json(
      { error: "Invalid ticket state transition" },
      { status: 409 },
    );
  }

  if (
    requestedStatus === "served" &&
    ticket.status === "cancelled"
  ) {
    return NextResponse.json(
      { error: "Cancelled ticket cannot be served" },
      { status: 409 },
    );
  }

  if (
    requestedStatus === "cancelled" &&
    ticket.status === "served"
  ) {
    return NextResponse.json(
      { error: "Served ticket cannot be cancelled" },
      { status: 409 },
    );
  }

  // Cancel order: remove items from customer's booking bill & restore stock
  if (requestedStatus === "cancelled") {
    if (ticket.checkedOutAt !== null) {
      return NextResponse.json(
        { error: "Cannot cancel an order after the session has checked out" },
        { status: 409 },
      );
    }

    await db.transaction(async (tx) => {
      const ticketItems = await tx
        .select()
        .from(bookingItems)
        .where(eq(bookingItems.ticketId, ticketId));

      for (const item of ticketItems) {
        if (item.productId) {
          await tx
            .update(products)
            .set({
              stockQuantity: sql`${products.stockQuantity} + ${item.quantity}`,
            })
            .where(eq(products.id, item.productId));
        }
      }

      await tx
        .delete(bookingItems)
        .where(eq(bookingItems.ticketId, ticketId));

      await tx
        .update(orderTickets)
        .set({ status: "cancelled" })
        .where(eq(orderTickets.id, ticketId));

      await tx.insert(auditLogs).values({
        userId: user.id,
        action: "order_ticket_cancelled",
        entityType: "order_ticket",
        entityId: ticketId,
        details: {
          ticketId,
          ticketNumber: ticket.ticketNumber,
          bookingId: ticket.bookingId,
          removedItems: ticketItems.map((item) => ({
            productId: item.productId,
            name: item.nameSnapshot,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      });
    });

    return NextResponse.json({ ok: true });
  }

  const update: {
    status?: TicketStatus;
    printedAt?: Date;
    servedAt?: Date;
  } = {};

  if (requestedStatus !== undefined) {
    update.status = requestedStatus;

    if (
      requestedStatus === "printed" &&
      !ticket.printedAt
    ) {
      update.printedAt = new Date();
    }

    if (requestedStatus === "served") {
      update.servedAt = new Date();
    }
  }

  if (markPrinted) {
    if (ticket.status === "cancelled") {
      return NextResponse.json(
        { error: "Cancelled ticket cannot be printed" },
        { status: 409 },
      );
    }

    update.printedAt = new Date();

    if (requestedStatus === undefined && ticket.status === "pending") {
      update.status = "printed";
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true });
  }

  await db
    .update(orderTickets)
    .set(update)
    .where(eq(orderTickets.id, ticketId));

  return NextResponse.json({ ok: true });
}