import { NextResponse } from "next/server";
import { and, eq, gt, lt, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  auditLogs,
  bookingItems,
  bookings,
  customerMeetingRoomPackages,
  customers,
  desks,
  meetingRoomCalendars,
  meetingRoomPackageUsageLedger,
  meetingRoomReservations,
} from "@/db/schema";

import { canManage, getCurrentUser } from "@/lib/auth";

import { getActiveShiftForUser } from "@/lib/shift";

import {
  calculateMeetingRoomBooking,
  validateAttendeeCount,
  validateMeetingRoomDuration,
} from "@/lib/meeting-room-billing";

import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getCalendarBusyPeriods,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;

const ACTIONS = ["add_people", "add_hours"] as const;
type Action = (typeof ACTIONS)[number];

type RequestBody = {
  action?: unknown;
  amount?: unknown;
};

type CalendarEventRef = {
  calendarId: string;
  eventId: string;
};

function parsePositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseAction(value: unknown): Action | null {
  return typeof value === "string" && ACTIONS.includes(value as Action)
    ? (value as Action)
    : null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const createdGoogleEvents: CalendarEventRef[] = [];

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
            "Only managers/admins can adjust meeting-room sessions.",
        },
        { status: 403 },
      );
    }

    const activeShift = await getActiveShiftForUser(user.id);

    if (!activeShift) {
      return NextResponse.json(
        {
          error:
            "Open a shift before adjusting a meeting-room session.",
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
    const action = parseAction(body.action);
    const amount = parsePositiveInteger(body.amount);

    if (!action) {
      return NextResponse.json(
        { error: "Adjustment action must be add_people or add_hours." },
        { status: 400 },
      );
    }

    if (!amount) {
      return NextResponse.json(
        { error: "Adjustment amount must be a positive whole number." },
        { status: 400 },
      );
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(29004, ${reservationId})`,
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
          discountPercentSnapshot:
            meetingRoomReservations.discountPercentSnapshot,
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

      if (reservation.status !== "active") {
        throw new Error(
          `Meeting room reservation cannot be adjusted from status "${reservation.status}".`,
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

      const currentAttendees = Number(reservation.attendeeCount);
      const currentDuration = Number(reservation.durationHours);

      if (!Number.isSafeInteger(currentAttendees) || currentAttendees <= 0) {
        throw new Error("The current attendee count is invalid.");
      }

      if (!Number.isFinite(currentDuration) || currentDuration <= 0) {
        throw new Error("The current session duration is invalid.");
      }

      const newAttendeeCount =
        action === "add_people"
          ? currentAttendees + amount
          : currentAttendees;

      const newDurationHours =
        action === "add_hours"
          ? currentDuration + amount
          : currentDuration;

      if (
        action === "add_people" &&
        !Number.isSafeInteger(newAttendeeCount)
      ) {
        throw new Error("The new attendee count is too large.");
      }

      const [room] = await tx
        .select({
          id: desks.id,
          name: desks.name,
          capacity: desks.capacity,
        })
        .from(desks)
        .where(
          and(
            eq(desks.id, reservation.deskId),
            eq(desks.active, true),
            eq(desks.type, "meeting_room"),
          ),
        )
        .limit(1);

      if (!room) {
        throw new Error("Meeting room not found or inactive.");
      }

      try {
        validateAttendeeCount(
          newAttendeeCount,
          room.capacity,
        );
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? error.message
            : "Invalid attendee count.",
        );
      }

      try {
        validateMeetingRoomDuration(newDurationHours);
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? error.message
            : "Invalid meeting room duration.",
        );
      }

      const newEndAt = new Date(
        reservation.startAt.getTime() +
          newDurationHours * HOUR_MS,
      );

      let mappingCalendarId: string | null = null;

      if (action === "add_hours") {
        const [roomConflict] = await tx
          .select({
            id: meetingRoomReservations.id,
            startAt: meetingRoomReservations.startAt,
            endAt: meetingRoomReservations.endAt,
          })
          .from(meetingRoomReservations)
          .where(
            and(
              eq(
                meetingRoomReservations.deskId,
                reservation.deskId,
              ),
              ne(
                meetingRoomReservations.id,
                reservation.id,
              ),
              or(
                eq(
                  meetingRoomReservations.status,
                  "confirmed",
                ),
                eq(
                  meetingRoomReservations.status,
                  "active",
                ),
              ),
              lt(
                meetingRoomReservations.startAt,
                newEndAt,
              ),
              gt(
                meetingRoomReservations.endAt,
                reservation.endAt,
              ),
            ),
          )
          .limit(1);

        if (roomConflict) {
          throw new Error(
            "The room is already occupied during the additional time.",
          );
        }

        const [mapping] = await tx
          .select({
            calendarId: meetingRoomCalendars.calendarId,
            calendarName: meetingRoomCalendars.calendarName,
          })
          .from(meetingRoomCalendars)
          .where(eq(meetingRoomCalendars.deskId, reservation.deskId))
          .limit(1);

        if (mapping?.calendarId && reservation.googleEventId) {
          mappingCalendarId = mapping.calendarId;
          const busy = await getCalendarBusyPeriods(
            mapping.calendarId,
            reservation.endAt.toISOString(),
            newEndAt.toISOString(),
          );

          if (busy.length > 0) {
            throw new Error(
              "The room is already busy in Google Calendar during the additional time.",
            );
          }

          const [customer] = await tx
            .select({ name: customers.name })
            .from(customers)
            .where(eq(customers.id, booking.customerId))
            .limit(1);

          const customerName = customer?.name || "Meeting room customer";

          const googleResult = await createGoogleCalendarEvent(
            mapping.calendarId,
            {
              summary: "Meeting Room — Active Session",
              description: [
                `Customer: ${customerName}`,
                `Attendees: ${newAttendeeCount}`,
                `Duration: ${newDurationHours} hour(s)`,
                `Session ID: ${reservation.id}`,
              ].join("\n"),
              start: reservation.startAt.toISOString(),
              end: newEndAt.toISOString(),
            },
          );

          if (!googleResult.id) {
            throw new Error(
              "Google Calendar did not return an event ID for the extended session.",
            );
          }

          createdGoogleEvents.push({
            calendarId: mapping.calendarId,
            eventId: googleResult.id,
          });
        }
      }

      let packageRemainingHours: number | null = null;
      const packagePurchaseId = reservation.packagePurchaseId;

      if (packagePurchaseId) {
        const [purchase] = await tx
          .select({
            id: customerMeetingRoomPackages.id,
            customerId: customerMeetingRoomPackages.customerId,
            status: customerMeetingRoomPackages.status,
            expiresAt: customerMeetingRoomPackages.expiresAt,
          })
          .from(customerMeetingRoomPackages)
          .where(eq(customerMeetingRoomPackages.id, packagePurchaseId))
          .limit(1);

        if (!purchase) {
          throw new Error("Meeting room package purchase not found.");
        }

        if (purchase.customerId !== booking.customerId) {
          throw new Error(
            "The meeting room package does not belong to this customer.",
          );
        }

        if (purchase.status !== "active") {
          throw new Error(
            "This meeting room package is no longer active.",
          );
        }

        if (
          purchase.expiresAt &&
          purchase.expiresAt.getTime() <= Date.now()
        ) {
          throw new Error("This meeting room package has expired.");
        }

        const ledgerRows = await tx
          .select({
            hoursDelta: meetingRoomPackageUsageLedger.hoursDelta,
          })
          .from(meetingRoomPackageUsageLedger)
          .where(
            eq(
              meetingRoomPackageUsageLedger.packagePurchaseId,
              packagePurchaseId,
            ),
          );

        const packageBalance = roundMoney(
          ledgerRows.reduce((sum, row) => {
            const delta = Number(row.hoursDelta);
            return Number.isFinite(delta) ? sum + delta : sum;
          }, 0),
        );

        const additionalPackageHours =
          action === "add_hours"
            ? roundMoney(newDurationHours - currentDuration)
            : 0;

        if (additionalPackageHours > packageBalance) {
          throw new Error(
            `Insufficient meeting room package balance. Remaining: ${packageBalance} hours, required: ${additionalPackageHours} hours.`,
          );
        }

        packageRemainingHours = roundMoney(
          Math.max(0, packageBalance - additionalPackageHours),
        );
      }

      const billing = await calculateMeetingRoomBooking({
        deskId: reservation.deskId,
        attendeeCount: newAttendeeCount,
        durationHours: newDurationHours,
      });

      const subtotalAmount = roundMoney(
        Number(billing.subtotalAmount),
      );

      const discountPercent = roundMoney(
        packagePurchaseId
          ? Number(reservation.discountPercentSnapshot)
          : 0,
      );

      if (
        !Number.isFinite(discountPercent) ||
        discountPercent < 0 ||
        discountPercent > 100
      ) {
        throw new Error("Invalid meeting room discount.");
      }

      const discountAmount = roundMoney(
        subtotalAmount * (discountPercent / 100),
      );

      const roomTotal = roundMoney(
        subtotalAmount - discountAmount,
      );

      const fnbRows = await tx
        .select({
          unitPrice: bookingItems.unitPrice,
          quantity: bookingItems.quantity,
        })
        .from(bookingItems)
        .where(eq(bookingItems.bookingId, booking.id));

      const fnbTotal = roundMoney(
        fnbRows.reduce(
          (sum, item) =>
            sum + Number(item.unitPrice) * Number(item.quantity),
          0,
        ),
      );

      const grandTotal = roundMoney(
        roomTotal + fnbTotal,
      );

      await tx
        .update(meetingRoomReservations)
        .set({
          attendeeCount: newAttendeeCount,
          endAt: newEndAt,
          durationHours: newDurationHours.toFixed(2),
          hourlyRateSnapshot: billing.hourlyRate,
          subtotalAmount: subtotalAmount.toFixed(2),
          discountPercentSnapshot:
            discountPercent.toFixed(2),
          discountAmount: discountAmount.toFixed(2),
          totalAmount: roomTotal.toFixed(2),
          packageHoursUsed: packagePurchaseId
            ? newDurationHours.toFixed(2)
            : null,
          ...(createdGoogleEvents.length > 0
            ? { googleEventId: createdGoogleEvents[createdGoogleEvents.length - 1].eventId }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(meetingRoomReservations.id, reservation.id));

      await tx
        .update(bookings)
        .set({
          hourlyRateSnapshot: billing.hourlyRate,
          seatCharge: subtotalAmount.toFixed(2),
          ordersTotal: fnbTotal.toFixed(2),
          discount: discountAmount.toFixed(2),
          total: grandTotal.toFixed(2),
        })
        .where(eq(bookings.id, booking.id));

      if (packagePurchaseId && action === "add_hours") {
        const additionalHours = roundMoney(
          newDurationHours - currentDuration,
        );

        if (additionalHours > 0) {
          const idempotencyKey =
            `meeting-room-adjust-hours:${reservation.id}:${newDurationHours.toFixed(2)}`;

          await tx.insert(meetingRoomPackageUsageLedger).values({
            packagePurchaseId,
            reservationId: reservation.id,
            userId: user.id,
            entryType: "usage",
            hoursDelta: `-${additionalHours.toFixed(2)}`,
            reason: `Additional meeting room hours for session #${reservation.id}`,
            idempotencyKey,
          });
        }

        if ((packageRemainingHours ?? 0) <= 0) {
          await tx
            .update(customerMeetingRoomPackages)
            .set({
              status: "exhausted",
              updatedAt: new Date(),
            })
            .where(eq(customerMeetingRoomPackages.id, packagePurchaseId));
        }
      }

      await tx.insert(auditLogs).values({
        userId: user.id,
        action: "meeting_room_session_adjusted",
        entityType: "meeting_room_reservation",
        entityId: reservation.id,
        details: {
          action,
          amount,
          bookingId: booking.id,
          roomId: reservation.deskId,
          customerId: booking.customerId,
          previousAttendeeCount: currentAttendees,
          newAttendeeCount,
          previousDurationHours: currentDuration,
          newDurationHours,
          previousEndAt: reservation.endAt.toISOString(),
          newEndAt: newEndAt.toISOString(),
          hourlyRate: billing.hourlyRate,
          subtotalAmount: subtotalAmount.toFixed(2),
          discountAmount: discountAmount.toFixed(2),
          roomTotal: roomTotal.toFixed(2),
          fnbTotal: fnbTotal.toFixed(2),
          grandTotal: grandTotal.toFixed(2),
          packagePurchaseId: packagePurchaseId ?? null,
          packageRemainingHours,
          newGoogleEventId:
            createdGoogleEvents[createdGoogleEvents.length - 1]?.eventId ?? null,
        },
      });

      return {
        reservationId: reservation.id,
        bookingId: booking.id,
        action,
        amount,
        attendeeCount: newAttendeeCount,
        durationHours: newDurationHours,
        startAt: reservation.startAt,
        endAt: newEndAt,
        hourlyRate: billing.hourlyRate,
        subtotalAmount,
        discountPercent,
        discountAmount,
        roomTotal,
        fnbTotal,
        grandTotal,
        packagePurchaseId,
        packageRemainingHours,
        googleEventId:
          createdGoogleEvents[createdGoogleEvents.length - 1]?.eventId ??
          reservation.googleEventId ??
          null,
        oldGoogleEvent:
          action === "add_hours" &&
          reservation.googleEventId &&
          mappingCalendarId
            ? {
                calendarId: mappingCalendarId,
                eventId: reservation.googleEventId,
              }
            : null,
      };
    });

    if (result.oldGoogleEvent && result.googleEventId) {
      try {
        await deleteGoogleCalendarEvent(
          result.oldGoogleEvent.calendarId,
          result.oldGoogleEvent.eventId,
        );
      } catch (calendarError) {
        console.error(
          "Meeting room adjustment succeeded, but old Google Calendar event could not be removed:",
          calendarError,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      ...result,
      startAt: result.startAt.toISOString(),
      endAt: result.endAt.toISOString(),
      hourlyRate: result.hourlyRate,
      subtotalAmount: result.subtotalAmount.toFixed(2),
      discountPercent: result.discountPercent.toFixed(2),
      discountAmount: result.discountAmount.toFixed(2),
      roomTotal: result.roomTotal.toFixed(2),
      fnbTotal: result.fnbTotal.toFixed(2),
      grandTotal: result.grandTotal.toFixed(2),
      packageRemainingHours:
        result.packageRemainingHours === null
          ? null
          : result.packageRemainingHours.toFixed(2),
    });
  } catch (error) {
    for (const created of createdGoogleEvents) {
      try {
        await deleteGoogleCalendarEvent(
          created.calendarId,
          created.eventId,
        );
      } catch (cleanupError) {
        console.error(
          "Failed to rollback new Google Calendar event after meeting room adjustment failure:",
          cleanupError,
        );
      }
    }

    const message =
      error instanceof Error
        ? error.message
        : "Could not adjust the meeting room session.";

    console.error("Meeting room session adjustment error:", error);

    return NextResponse.json(
      { error: message },
      { status: 400 },
    );
  }
}
