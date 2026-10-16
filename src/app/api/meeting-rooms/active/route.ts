
import { NextResponse } from "next/server";
import {
  asc,
  eq,
  inArray,
} from "drizzle-orm";

import { db } from "@/db";
import {
  bookingItems,
  bookings,
  customers,
  desks,
  meetingRoomReservations,
} from "@/db/schema";

import { getCurrentUser } from "@/lib/auth";

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

    // Fetch active reservations without aggregating booking items.
    // This avoids the PostgreSQL GROUP BY error and preserves
    // the original reservation and customer information.
    const rows = await db
      .select({
        reservationId:
          meetingRoomReservations.id,

        bookingId:
          meetingRoomReservations.bookingId,

        roomId:
          meetingRoomReservations.deskId,

        roomName:
          desks.name,

        customerId:
          meetingRoomReservations.customerId,

        customerName:
          customers.name,

        customerPhone:
          customers.phone,

        customerBalance:
          customers.balance,

        accessCode:
          bookings.accessCode,

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
      .where(
        eq(
          meetingRoomReservations.status,
          "active",
        ),
      )
      .orderBy(
        asc(
          meetingRoomReservations.startAt,
        ),
      );

    // Collect valid booking IDs for the separate order query.
    const bookingIds = [
      ...new Set(
        rows
          .map((row) => row.bookingId)
          .filter(
            (id): id is number =>
              id !== null &&
              Number.isSafeInteger(id) &&
              id > 0,
          ),
      ),
    ];

    // Fetch all order items associated with these bookings.
    const itemRows = bookingIds.length
      ? await db
          .select({
            bookingId:
              bookingItems.bookingId,

            id:
              bookingItems.id,

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
            asc(
              bookingItems.createdAt,
            ),
          )
      : [];

    // Group order items by booking while preserving each item's details.
    const itemsByBooking = new Map<
      number,
      ActiveOrderItem[]
    >();

    // Calculate the F&B total separately for each booking.
    const fnbTotalsByBooking = new Map<
      number,
      number
    >();

    for (const item of itemRows) {
      const list =
        itemsByBooking.get(item.bookingId) ?? [];

      list.push({
        id: item.id,
        name: item.name,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        createdAt: item.createdAt.toISOString(),
      });

      itemsByBooking.set(
        item.bookingId,
        list,
      );

      const currentTotal =
        fnbTotalsByBooking.get(item.bookingId) ?? 0;

      fnbTotalsByBooking.set(
        item.bookingId,
        currentTotal +
          Number(item.unitPrice) * item.quantity,
      );
    }

    return NextResponse.json({
      ok: true,

      sessions: rows.map((row) => {
        const roomTotal = Number(
          row.roomTotal,
        );

        const fnbTotal =
          row.bookingId !== null
            ? fnbTotalsByBooking.get(
                row.bookingId,
              ) ?? 0
            : 0;

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

          customerBalance:
            Number(
              row.customerBalance ?? 0,
            ),

          accessCode:
            row.accessCode,

          startAt:
            row.startAt.toISOString(),

          endAt:
            row.endAt.toISOString(),

          attendeeCount:
            row.attendeeCount,

          durationHours:
            Number(
              row.durationHours,
            ),

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
