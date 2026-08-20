import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  orderTickets,
  bookings,
  customers,
  desks,
  bookingItems,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { id } = await params;
  const ticketId = Number(id);

  if (!ticketId) {
    return NextResponse.json(
      { error: "Invalid ticket id" },
      { status: 400 },
    );
  }

  const [ticket] = await db
    .select({
      id: orderTickets.id,
      ticketNumber:
        orderTickets.ticketNumber,
      status: orderTickets.status,
      customerNote:
        orderTickets.customerNote,
      printedAt:
        orderTickets.printedAt,
      servedAt:
        orderTickets.servedAt,
      createdAt:
        orderTickets.createdAt,
      bookingId:
        orderTickets.bookingId,
      deskName:
        desks.name,
      customerName:
        customers.name,
    })
    .from(orderTickets)
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
        ticketId,
      ),
    )
    .limit(1);

  if (!ticket) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404 },
    );
  }

  // IMPORTANT:
  // Get only items belonging to this ticket.
  const items = await db
    .select()
    .from(bookingItems)
    .where(
      eq(
        bookingItems.ticketId,
        ticketId,
      ),
    );

  return NextResponse.json({
    ticket: {
      id: ticket.id,
      ticketNumber:
        ticket.ticketNumber,
      status: ticket.status,
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
      deskName:
        ticket.deskName,
      customerName:
        ticket.customerName,

      items: items.map(
        (item) => ({
          id: item.id,
          name:
            item.nameSnapshot,
          quantity:
            item.quantity,
          unitPrice:
            item.unitPrice,
          note:
            item.itemNote,
        }),
      ),
    },
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

  const { id } = await params;
  const ticketId = Number(id);

  if (!ticketId) {
    return NextResponse.json(
      { error: "Invalid ticket id" },
      { status: 400 },
    );
  }

  const body =
    (await req.json()) as {
      status?:
        | "pending"
        | "printed"
        | "served"
        | "cancelled";
      markPrinted?: boolean;
    };

  const update: {
    status?:
      | "pending"
      | "printed"
      | "served"
      | "cancelled";
    printedAt?: Date;
    servedAt?: Date;
  } = {};

  if (body.status) {
    update.status = body.status;
  }

  if (body.markPrinted) {
    update.printedAt = new Date();

    if (!body.status) {
      update.status = "printed";
    }
  }

  if (body.status === "served") {
    update.servedAt = new Date();
  }

  if (
    Object.keys(update).length === 0
  ) {
    return NextResponse.json({
      ok: true,
    });
  }

  await db
    .update(orderTickets)
    .set(update)
    .where(
      eq(
        orderTickets.id,
        ticketId,
      ),
    );

  return NextResponse.json({
    ok: true,
  });
}