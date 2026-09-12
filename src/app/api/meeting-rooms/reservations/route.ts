import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  desks,
  customers,
  meetingRoomReservations,
} from "@/db/schema";
import { and, eq, lt, gt } from "drizzle-orm";
import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

type Body = {
  deskId?: number;
  customerId?: number;
  customerName?: string;
  customerPhone?: string;
  startAt?: string;
  endAt?: string;
  recurrence?: "none" | "weekly";
  recurrenceCount?: number;
  notes?: string;
};

function buildOccurrenceDates(
  start: Date,
  end: Date,
  recurrence: "none" | "weekly",
  count: number,
) {
  const result: {
    start: Date;
    end: Date;
  }[] = [];

  const safeCount =
    recurrence === "weekly"
      ? Math.max(1, Math.min(count, 52))
      : 1;

  for (let i = 0; i < safeCount; i++) {
    const occurrenceStart = new Date(start);
    const occurrenceEnd = new Date(end);

    if (recurrence === "weekly") {
      occurrenceStart.setDate(
        occurrenceStart.getDate() + i * 7,
      );

      occurrenceEnd.setDate(
        occurrenceEnd.getDate() + i * 7,
      );
    }

    result.push({
      start: occurrenceStart,
      end: occurrenceEnd,
    });
  }

  return result;
}

export async function POST(req: Request) {
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
            "Only managers/admins can create meeting-room reservations.",
        },
        { status: 403 },
      );
    }

    const body =
      (await req.json().catch(() => null)) as Body | null;

    if (!body?.deskId) {
      return NextResponse.json(
        { error: "Meeting room is required." },
        { status: 400 },
      );
    }

    if (!body.startAt || !body.endAt) {
      return NextResponse.json(
        {
          error:
            "Start and end time are required.",
        },
        { status: 400 },
      );
    }

    const start = new Date(body.startAt);
    const end = new Date(body.endAt);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      return NextResponse.json(
        { error: "Invalid reservation time." },
        { status: 400 },
      );
    }

    if (start <= new Date()) {
      return NextResponse.json(
        {
          error:
            "Reservation must be in the future.",
        },
        { status: 400 },
      );
    }

    const [room] = await db
      .select({
        id: desks.id,
        name: desks.name,
        hourlyRate: desks.hourlyRate,
      })
      .from(desks)
      .where(
        and(
          eq(desks.id, body.deskId),
          eq(desks.type, "meeting_room"),
          eq(desks.active, true),
        ),
      )
      .limit(1);

    if (!room) {
      return NextResponse.json(
        { error: "Meeting room not found." },
        { status: 404 },
      );
    }

    const recurrence =
      body.recurrence === "weekly"
        ? "weekly"
        : "none";

    const count =
      recurrence === "weekly"
        ? Math.max(
            1,
            Math.min(
              Number(body.recurrenceCount || 1),
              52,
            ),
          )
        : 1;

    const occurrences = buildOccurrenceDates(
      start,
      end,
      recurrence,
      count,
    );

    // -------------------------------------------------------------------------
    // CHECK INTERNAL DATABASE CONFLICTS
    // -------------------------------------------------------------------------

    for (const occurrence of occurrences) {
      const conflicts = await db
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
              room.id,
            ),
            eq(
              meetingRoomReservations.status,
              "confirmed",
            ),
            lt(
              meetingRoomReservations.startAt,
              occurrence.end,
            ),
            gt(
              meetingRoomReservations.endAt,
              occurrence.start,
            ),
          ),
        )
        .limit(1);

      if (conflicts.length > 0) {
        return NextResponse.json(
          {
            error:
              "The meeting room is already booked for one of the requested times.",
            conflictingStart:
              conflicts[0].startAt.toISOString(),
            conflictingEnd:
              conflicts[0].endAt.toISOString(),
          },
          { status: 409 },
        );
      }
    }

    // -------------------------------------------------------------------------
    // CUSTOMER
    // -------------------------------------------------------------------------

    let customerId = body.customerId;

    if (!customerId) {
      if (
        !body.customerName?.trim() ||
        !body.customerPhone?.trim()
      ) {
        return NextResponse.json(
          {
            error:
              "Customer name and phone are required.",
          },
          { status: 400 },
        );
      }

      const [customer] = await db
        .insert(customers)
        .values({
          name: body.customerName.trim(),
          phone: body.customerPhone.trim(),
        })
        .returning({
          id: customers.id,
        });

      customerId = customer.id;
    }

    // -------------------------------------------------------------------------
    // CREATE INTERNAL RESERVATIONS
    // -------------------------------------------------------------------------

    const createdReservations = [];

    for (const occurrence of occurrences) {
      const [reservation] = await db
        .insert(meetingRoomReservations)
        .values({
          deskId: room.id,
          customerId,
          userId: user.id,
          startAt: occurrence.start,
          endAt: occurrence.end,
          recurrenceRule:
            recurrence === "weekly"
              ? `RRULE:FREQ=WEEKLY;COUNT=${count}`
              : null,
          recurrenceCount:
            count > 1 ? count : null,
          status: "confirmed",
          notes: body.notes?.trim() || null,
        })
        .returning({
          id: meetingRoomReservations.id,
        });

      createdReservations.push(reservation.id);
    }

    return NextResponse.json({
      ok: true,
      reservationIds: createdReservations,
      roomName: room.name,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      recurrence,
      recurrenceCount: count,
    });
  } catch (error) {
    console.error(
      "Create meeting room reservation error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not create meeting room reservation.",
      },
      { status: 500 },
    );
  }
}