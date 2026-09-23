import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  auditLogs,
  bookingItems,
  bookings,
  meetingRoomCalendars,
  meetingRoomReservations,
} from "@/db/schema";

import { canManage, getCurrentUser } from "@/lib/auth";

import { deleteGoogleCalendarEvent } from "@/lib/google-calendar";
import { getActiveShiftForUser } from "@/lib/shift";

export const dynamic = "force-dynamic";

const PAYMENT_METHODS = [
  "cash",
  "visa",
  "instapay",
] as const;

type PaymentMethod = (typeof PAYMENT_METHODS)[number];

type RequestBody = {
  paidAmount?: number | string;
  paymentMethod?: string;
  discountAmount?: number | string;
};

type CalendarEventToDelete = {
  calendarId: string;
  eventId: string;
};

type CheckoutResult = {
  alreadyClosed: boolean;
  reservationId: number;
  bookingId: number | null;
  roomAmount: number;
  fnbAmount: number;
  grandTotal: number;
  paidAmount: number;
  changeAmount: number;
  itemCount: number;
  googleEventToDelete: CalendarEventToDelete | null;
};

function parsePositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseMoney(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
        {
          error:
            "Only managers/admins can checkout meeting-room sessions.",
        },
        { status: 403 },
      );
    }

    const activeShift = await getActiveShiftForUser(user.id);

    if (!activeShift) {
      return NextResponse.json(
        {
          error: "Open a shift before checking out a meeting-room session.",
        },
        { status: 400 },
      );
    }

    const { id } = await params;
    const reservationId = parsePositiveInteger(id);

    if (!reservationId) {
      return NextResponse.json(
        { error: "Invalid meeting room reservation id." },
        { status: 400 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody;

    const paymentMethod =
      typeof body.paymentMethod === "string" && body.paymentMethod.trim()
        ? body.paymentMethod.trim()
        : "cash";

    if (!PAYMENT_METHODS.includes(paymentMethod as PaymentMethod)) {
      return NextResponse.json(
        { error: "Payment method must be cash, visa or instapay." },
        { status: 400 },
      );
    }

    const requestedPaidAmount =
      body.paidAmount === undefined
        ? null
        : parseMoney(body.paidAmount);

    if (body.paidAmount !== undefined && requestedPaidAmount === null) {
      return NextResponse.json(
        { error: "Paid amount must be a valid non-negative number." },
        { status: 400 },
      );
    }

    const requestedDiscountAmount =
      body.discountAmount === undefined
        ? 0
        : parseMoney(body.discountAmount);

    if (requestedDiscountAmount === null) {
      return NextResponse.json(
        { error: "Discount amount must be a valid non-negative number." },
        { status: 400 },
      );
    }

    const result: CheckoutResult = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(29003, ${reservationId})`,
      );

      const [reservation] = await tx
        .select({
          id: meetingRoomReservations.id,
          deskId: meetingRoomReservations.deskId,
          customerId: meetingRoomReservations.customerId,
          bookingId: meetingRoomReservations.bookingId,
          startAt: meetingRoomReservations.startAt,
          endAt: meetingRoomReservations.endAt,
          attendeeCount: meetingRoomReservations.attendeeCount,
          hourlyRateSnapshot: meetingRoomReservations.hourlyRateSnapshot,
          durationHours: meetingRoomReservations.durationHours,
          subtotalAmount: meetingRoomReservations.subtotalAmount,
          discountAmount: meetingRoomReservations.discountAmount,
          totalAmount: meetingRoomReservations.totalAmount,
          packagePurchaseId: meetingRoomReservations.packagePurchaseId,
          packageHoursUsed: meetingRoomReservations.packageHoursUsed,
          googleEventId: meetingRoomReservations.googleEventId,
          status: meetingRoomReservations.status,
          notes: meetingRoomReservations.notes,
        })
        .from(meetingRoomReservations)
        .where(eq(meetingRoomReservations.id, reservationId))
        .limit(1);

      if (!reservation) {
        throw new Error("Meeting room reservation not found.");
      }

      if (reservation.status === "closed") {
        const [closedBooking] = reservation.bookingId
          ? await tx
              .select({
                id: bookings.id,
                total: bookings.total,
                paidAmount: bookings.paidAmount,
                changeAmount: bookings.changeAmount,
              })
              .from(bookings)
              .where(eq(bookings.id, reservation.bookingId))
              .limit(1)
          : [];

        const closedItems = reservation.bookingId
          ? await tx
              .select({
                unitPrice: bookingItems.unitPrice,
                quantity: bookingItems.quantity,
              })
              .from(bookingItems)
              .where(eq(bookingItems.bookingId, reservation.bookingId))
          : [];

        const fnbAmount = roundMoney(
          closedItems.reduce(
            (sum, item) =>
              sum + Number(item.unitPrice) * Number(item.quantity),
            0,
          ),
        );

        const grandTotal = roundMoney(
          Number(
            closedBooking?.total ?? reservation.totalAmount,
          ),
        );

        return {
          alreadyClosed: true,
          reservationId: reservation.id,
          bookingId: closedBooking?.id ?? reservation.bookingId,
          roomAmount: roundMoney(Number(reservation.totalAmount)),
          fnbAmount,
          grandTotal,
          paidAmount: roundMoney(Number(closedBooking?.paidAmount ?? 0)),
          changeAmount: roundMoney(
            Number(closedBooking?.changeAmount ?? 0),
          ),
          itemCount: closedItems.reduce(
            (sum, item) => sum + Number(item.quantity),
            0,
          ),
          googleEventToDelete: null,
        } satisfies CheckoutResult;
      }

      if (reservation.status !== "active") {
        throw new Error(
          `Meeting room reservation cannot be checked out from status "${reservation.status}".`,
        );
      }

      if (!reservation.bookingId) {
        throw new Error(
          "This meeting room session is not linked to a customer session.",
        );
      }

      const [booking] = await tx
        .select({
          id: bookings.id,
          customerId: bookings.customerId,
          shiftId: bookings.shiftId,
          status: bookings.status,
        })
        .from(bookings)
        .where(eq(bookings.id, reservation.bookingId))
        .limit(1);

      if (!booking) {
        throw new Error(
          "The customer session linked to this meeting room no longer exists.",
        );
      }

      if (booking.status !== "active") {
        throw new Error(
          `The linked customer session is already ${booking.status}.`,
        );
      }

      if (booking.shiftId !== activeShift.id) {
        throw new Error(
          "This meeting room session does not belong to your active shift.",
        );
      }

      const items = await tx
        .select({
          id: bookingItems.id,
          unitPrice: bookingItems.unitPrice,
          quantity: bookingItems.quantity,
        })
        .from(bookingItems)
        .where(eq(bookingItems.bookingId, booking.id));

      const fnbAmount = roundMoney(
        items.reduce(
          (sum, item) =>
            sum + Number(item.unitPrice) * Number(item.quantity),
          0,
        ),
      );

      const roomAmount = roundMoney(Number(reservation.totalAmount));
      const packageDiscountAmount = roundMoney(
        Number(reservation.discountAmount ?? 0),
      );
      const subtotalGrandTotal = roundMoney(
        roomAmount + fnbAmount,
      );
      const manualDiscountAmount = roundMoney(
        Number(requestedDiscountAmount),
      );

      if (manualDiscountAmount > subtotalGrandTotal) {
        throw new Error(
          `Discount cannot exceed the session total of ${subtotalGrandTotal.toFixed(2)}.`,
        );
      }

      const totalDiscountAmount = roundMoney(
        packageDiscountAmount + manualDiscountAmount,
      );
      const grandTotal = roundMoney(
        subtotalGrandTotal - manualDiscountAmount,
      );

      const paidAmount = roundMoney(requestedPaidAmount ?? grandTotal);

      if (paidAmount < grandTotal) {
        throw new Error(
          `Insufficient payment. Total is ${grandTotal.toFixed(2)} and paid amount is ${paidAmount.toFixed(2)}.`,
        );
      }

      const changeAmount = roundMoney(paidAmount - grandTotal);
      const checkedOutAt = new Date();

      await tx
        .update(bookings)
        .set({
          checkedOutAt,
          hourlyRateSnapshot: reservation.hourlyRateSnapshot,
          seatCharge: reservation.subtotalAmount,
          ordersTotal: fnbAmount.toFixed(2),
          discount: totalDiscountAmount.toFixed(2),
          total: grandTotal.toFixed(2),
          paidAmount: paidAmount.toFixed(2),
          changeAmount: changeAmount.toFixed(2),
          paymentMethod: paymentMethod as PaymentMethod,
          billingNote: `Meeting room reservation #${reservation.id}`,
          status: "closed",
        })
        .where(eq(bookings.id, booking.id));

      await tx
        .update(meetingRoomReservations)
        .set({
          status: "closed",
          updatedAt: checkedOutAt,
        })
        .where(eq(meetingRoomReservations.id, reservation.id));

      await tx.insert(auditLogs).values({
        userId: user.id,
        action: "meeting_room_session_checked_out",
        entityType: "meeting_room_reservation",
        entityId: reservation.id,
        details: {
          bookingId: booking.id,
          roomId: reservation.deskId,
          customerId: booking.customerId,
          roomAmount: roomAmount.toFixed(2),
          fnbAmount: fnbAmount.toFixed(2),
          packageDiscountAmount: packageDiscountAmount.toFixed(2),
          manualDiscountAmount: manualDiscountAmount.toFixed(2),
          totalDiscountAmount: totalDiscountAmount.toFixed(2),
          grandTotal: grandTotal.toFixed(2),
          paidAmount: paidAmount.toFixed(2),
          changeAmount: changeAmount.toFixed(2),
          paymentMethod,
          itemCount: items.reduce(
            (sum, item) => sum + Number(item.quantity),
            0,
          ),
        },
      });

      const [mapping] = await tx
        .select({
          calendarId: meetingRoomCalendars.calendarId,
        })
        .from(meetingRoomCalendars)
        .where(eq(meetingRoomCalendars.deskId, reservation.deskId))
        .limit(1);

      const googleEventToDelete: CalendarEventToDelete | null =
        mapping?.calendarId && reservation.googleEventId
          ? {
              calendarId: mapping.calendarId,
              eventId: reservation.googleEventId,
            }
          : null;

      return {
        alreadyClosed: false,
        reservationId: reservation.id,
        bookingId: booking.id,
        roomAmount,
        fnbAmount,
        grandTotal,
        paidAmount,
        changeAmount,
        itemCount: items.reduce(
          (sum, item) => sum + Number(item.quantity),
          0,
        ),
        googleEventToDelete,
      } satisfies CheckoutResult;
    });

    if (result.googleEventToDelete) {
      try {
        await deleteGoogleCalendarEvent(
          result.googleEventToDelete.calendarId,
          result.googleEventToDelete.eventId,
        );
      } catch (calendarError) {
        console.error(
          "Failed to remove meeting room Google Calendar event after checkout:",
          calendarError,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      alreadyClosed: result.alreadyClosed,
      reservationId,
      bookingId: result.bookingId,
      roomAmount: result.roomAmount.toFixed(2),
      fnbAmount: result.fnbAmount.toFixed(2),
      grandTotal: result.grandTotal.toFixed(2),
      discountAmount: Number(requestedDiscountAmount).toFixed(2),
      paidAmount: result.paidAmount.toFixed(2),
      changeAmount: result.changeAmount.toFixed(2),
      paymentMethod,
      itemCount: result.itemCount,
      invoiceUrl: result.bookingId ? `/invoice/${result.bookingId}` : null,
    });
  } catch (error) {
    console.error("Meeting room checkout error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Could not checkout the meeting room session.";

    return NextResponse.json(
      { error: message },
      {
        status:
          message.includes("Insufficient payment") ||
          message.includes("Discount cannot exceed")
            ? 400
            : 500,
      },
    );
  }
}
