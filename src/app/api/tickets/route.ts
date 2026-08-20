import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  orderTickets,
  bookings,
  customers,
  desks,
  bookingItems,
} from "@/db/schema";
import { desc, eq, inArray, ne } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
    ? ne(orderTickets.status, "served")
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
    .where(where)
    .orderBy(
      desc(orderTickets.createdAt),
    )
    .limit(60);

  if (ticketRows.length === 0) {
    return NextResponse.json({
      tickets: [],
    });
  }

  // Get the exact items belonging to these tickets
  const ticketIds = ticketRows.map(
    (ticket) => ticket.id,
  );

  const items = await db
    .select()
    .from(bookingItems)
    .where(
      inArray(
        bookingItems.ticketId,
        ticketIds,
      ),
    );

  const itemsByTicket =
    new Map<number, typeof items>();

  for (const item of items) {
    if (!item.ticketId) continue;

    const list =
      itemsByTicket.get(item.ticketId) || [];

    list.push(item);

    itemsByTicket.set(
      item.ticketId,
      list,
    );
  }

  return NextResponse.json({
    tickets: ticketRows.map(
      (ticket) => {
        const ticketItems =
          itemsByTicket.get(ticket.id) || [];

        const total =
          ticketItems.reduce(
            (sum, item) =>
              sum +
              item.quantity *
                parseFloat(
                  item.unitPrice,
                ),
            0,
          );

        return {
          id: ticket.id,
          ticketNumber:
            ticket.ticketNumber,
          status: ticket.status,
          source: ticket.source,
          customerNote:
            ticket.customerNote,
          printedAt:
            ticket.printedAt,
          servedAt:
            ticket.servedAt,
          createdAt:
            ticket.createdAt,
          bookingId:
            ticket.bookingId,
          deskId:
            ticket.deskId,
          deskName:
            ticket.deskName,
          customerName:
            ticket.customerName,
          customerPhone:
            ticket.customerPhone,

          items: ticketItems.map(
            (item) => ({
              id: item.id,
              name:
                item.nameSnapshot,
              unitPrice:
                item.unitPrice,
              quantity:
                item.quantity,
              note:
                item.itemNote,
            }),
          ),

          total,
        };
      },
    ),
  });
}