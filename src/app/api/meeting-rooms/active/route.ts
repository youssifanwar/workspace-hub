import { NextResponse } from "next/server";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  bookingItems,
  bookings,
  customers,
  desks,
  meetingRoomReservations,
} from "@/db/schema";

import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

type ActiveOrderItem = {
  id: number;
  name: string;
  unitPrice: string;
  quantity: number;
  createdAt: string;
};

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    if (!canManage(user.role)) {
      return NextResponse.json(
        { error: "Permission denied." },
        { status: 403 },
      );
    }

    const now = new Date();

    const rows = await db
      .select({
        reservationId:
          meetingRoomReservations.id,
        bookingId:
          meetingRoomReservations.bookingId,
        roomId:
          meetingRoomReservations.deskId,
        roomName: desks.name,
        customerId:
          meetingRoomReservations.customerId,
        customerName: customers.name,
        customerPhone: customers.phone,
        accessCode: bookings.accessCode,
        startAt:
          meetingRoomReservations.startAt,
        endAt:
          meetingRoomReservations.endAt,
        attendeeCount:
          meetingRoomReservations.attendeeCount,
        durationHours:
          meetingRoomReservations.durationHours,
        hourlyRate:
          meetingRoomReservations.hourlyRateSnapshot,
        roomSubtotal:
          meetingRoomReservations.subtotalAmount,
        roomDiscount:
          meetingRoomReservations.discountAmount,
        roomTotal:
          meetingRoomReservations.totalAmount,
        packagePurchaseId:
          meetingRoomReservations.packagePurchaseId,
        status:
          meetingRoomReservations.status,
        notes:
          meetingRoomReservations.notes,
        fnbTotal: sql<string>`
          coalesce(
            sum(
              ${bookingItems.unitPrice} *
              ${bookingItems.quantity}
            ),
            0
          )
        `,
      })
      .from(meetingRoomReservations)
      .innerJoin(
        desks,
        eq(
          desks.id,
          meetingRoomReservations.deskId,
        ),
      )
      .leftJoin(
        customers,
        eq(
          customers.id,
          meetingRoomReservations.customerId,
        ),
      )
      .leftJoin(
        bookings,
        eq(
          bookings.id,
          meetingRoomReservations.bookingId,
        ),
      )
      .leftJoin(
        bookingItems,
        eq(
          bookingItems.bookingId,
          bookings.id,
        ),
      )
      .where(
        and(
          eq(
            meetingRoomReservations.status,
            "active",
          ),
          gt(
            meetingRoomReservations.endAt,
            now,
          ),
        ),
      )
      .groupBy(
        meetingRoomReservations.id,
        meetingRoomReservations.bookingId,
        meetingRoomReservations.deskId,
        desks.name,
        meetingRoomReservations.customerId,
        customers.name,
        customers.phone,
        bookings.accessCode,
        meetingRoomReservations.startAt,
        meetingRoomReservations.endAt,
        meetingRoomReservations.attendeeCount,
        meetingRoomReservations.durationHours,
        meetingRoomReservations.hourlyRateSnapshot,
        meetingRoomReservations.subtotalAmount,
        meetingRoomReservations.discountAmount,
        meetingRoomReservations.totalAmount,
        meetingRoomReservations.packagePurchaseId,
        meetingRoomReservations.status,
        meetingRoomReservations.notes,
      )
      .orderBy(
        asc(
          meetingRoomReservations.startAt,
        ),
      );

    const bookingIds: number[] = [];

    for (const row of rows) {
      const id = row.bookingId;

      if (
        id !== null &&
        Number.isSafeInteger(id) &&
        id > 0
      ) {
        bookingIds.push(id);
      }
    }

    const itemRows = bookingIds.length
      ? await db
          .select({
            bookingId:
              bookingItems.bookingId,
            id: bookingItems.id,
            name:
              bookingItems.nameSnapshot,
            unitPrice:
              bookingItems.unitPrice,
            quantity:
              bookingItems.quantity,
            createdAt:
              bookingItems.createdAt,
          })
          .from(bookingItems)
          .where(
            inArray(
              bookingItems.bookingId,
              bookingIds,
            ),
          )
          .orderBy(
            asc(bookingItems.createdAt),
          )
      : [];

    const itemsByBooking = new Map<
      number,
      ActiveOrderItem[]
    >();

    for (const item of itemRows) {
      const list =
        itemsByBooking.get(item.bookingId) ?? [];

      list.push({
        id: item.id,
        name: item.name,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        createdAt:
          item.createdAt.toISOString(),
      });

      itemsByBooking.set(
        item.bookingId,
        list,
      );
    }

    return NextResponse.json({
      ok: true,
      sessions: rows.map((row) => {
        const roomTotal = Number(
          row.roomTotal,
        );

        const fnbTotal = Number(
          row.fnbTotal,
        );

        const items =
          row.bookingId !== null
            ? itemsByBooking.get(
                row.bookingId,
              ) ?? []
            : [];

        return {
          reservationId:
            row.reservationId,

          bookingId:
            row.bookingId,

          roomId:
            row.roomId,

          roomName:
            row.roomName,

          customerId:
            row.customerId,

          customerName:
            row.customerName,

          customerPhone:
            row.customerPhone,

          accessCode:
            row.accessCode,

          startAt:
            row.startAt.toISOString(),

          endAt:
            row.endAt.toISOString(),

          attendeeCount:
            row.attendeeCount,

          durationHours:
            Number(row.durationHours),

          hourlyRate:
            row.hourlyRate,

          roomSubtotal:
            Number(
              row.roomSubtotal,
            ).toFixed(2),

          roomDiscount:
            Number(
              row.roomDiscount,
            ).toFixed(2),

          roomTotal:
            roomTotal.toFixed(2),

          fnbTotal:
            fnbTotal.toFixed(2),

          grandTotal:
            (
              roomTotal +
              fnbTotal
            ).toFixed(2),

          itemCount:
            items.reduce(
              (sum, item) =>
                sum + item.quantity,
              0,
            ),

          items,

          packagePurchaseId:
            row.packagePurchaseId,

          status:
            row.status,

          notes:
            row.notes,
        };
      }),
    });
  } catch (error) {
    console.error(
      "Active meeting rooms error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load active meeting room sessions.",
      },
      { status: 500 },
    );
  }
}