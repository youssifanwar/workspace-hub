import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  desks,
  customers,
  meetingRoomCalendars,
  meetingRoomReservations,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";
import {
  getCalendarBusyPeriods,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
} from "@/lib/google-calendar";

export const dynamic =
  "force-dynamic";

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

function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
) {
  return (
    aStart < bEnd &&
    aEnd > bStart
  );
}

function buildOccurrenceDates(
  start: Date,
  end: Date,
  recurrence: "none" | "weekly",
  count: number,
) {
  const result = [];

  const safeCount =
    recurrence ===
    "weekly"
      ? Math.max(
          1,
          Math.min(
            count,
            52,
          ),
        )
      : 1;

  for (
    let i = 0;
    i < safeCount;
    i++
  ) {
    const s = new Date(
      start,
    );
    const e = new Date(
      end,
    );

    if (
      recurrence ===
      "weekly"
    ) {
      s.setDate(
        s.getDate() +
          i * 7,
      );

      e.setDate(
        e.getDate() +
          i * 7,
      );
    }

    result.push({
      start: s,
      end: e,
    });
  }

  return result;
}

export async function POST(
  req: Request,
) {
  let createdGoogleEvent:
    | string
    | null = null;

  let createdCalendarId:
    | string
    | null = null;

  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    if (
      !canManage(
        user.role,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Only managers/admins can create meeting-room reservations.",
        },
        {
          status: 403,
        },
      );
    }

    const body =
      (await req
        .json()
        .catch(
          () => null,
        )) as Body | null;

    if (
      !body?.deskId
    ) {
      return NextResponse.json(
        {
          error:
            "Meeting room is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !body.startAt ||
      !body.endAt
    ) {
      return NextResponse.json(
        {
          error:
            "Start and end time are required.",
        },
        {
          status: 400,
        },
      );
    }

    const start =
      new Date(
        body.startAt,
      );

    const end =
      new Date(
        body.endAt,
      );

    if (
      Number.isNaN(
        start.getTime(),
      ) ||
      Number.isNaN(
        end.getTime(),
      ) ||
      end <= start
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid reservation time.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      start <=
      new Date()
    ) {
      return NextResponse.json(
        {
          error:
            "Reservation must be in the future.",
        },
        {
          status: 400,
        },
      );
    }

    const [
      room,
    ] = await db
      .select({
        id: desks.id,
        name: desks.name,
        hourlyRate:
          desks.hourlyRate,
      })
      .from(desks)
      .where(
        and(
          eq(
            desks.id,
            body.deskId,
          ),
          eq(
            desks.type,
            "meeting_room",
          ),
          eq(
            desks.active,
            true,
          ),
        ),
      )
      .limit(1);

    if (!room) {
      return NextResponse.json(
        {
          error:
            "Meeting room not found.",
        },
        {
          status: 404,
        },
      );
    }

    const [
      mapping,
    ] = await db
      .select({
        calendarId:
          meetingRoomCalendars.calendarId,
        calendarName:
          meetingRoomCalendars.calendarName,
      })
      .from(
        meetingRoomCalendars,
      )
      .where(
        eq(
          meetingRoomCalendars.deskId,
          room.id,
        ),
      )
      .limit(1);

    if (!mapping) {
      return NextResponse.json(
        {
          error:
            "This room is not linked to a Google Calendar.",
        },
        {
          status: 400,
        },
      );
    }

    const recurrence =
      body.recurrence ===
      "weekly"
        ? "weekly"
        : "none";

    const count =
      recurrence ===
      "weekly"
        ? Math.max(
            1,
            Math.min(
              Number(
                body.recurrenceCount ||
                  1,
              ),
              52,
            ),
          )
        : 1;

    const occurrences =
      buildOccurrenceDates(
        start,
        end,
        recurrence,
        count,
      );

    // -------------------------------------------------------------------------
    // CHECK EVERY OCCURRENCE AGAINST GOOGLE
    // -------------------------------------------------------------------------

    for (
      const occurrence of
        occurrences
    ) {
      const busy =
        await getCalendarBusyPeriods(
          mapping.calendarId,
          occurrence.start.toISOString(),
          occurrence.end.toISOString(),
        );

      const conflict =
        busy.some(
          (period) =>
            overlaps(
              occurrence.start,
              occurrence.end,
              new Date(
                period.start,
              ),
              new Date(
                period.end,
              ),
            ),
        );

      if (conflict) {
        return NextResponse.json(
          {
            error:
              "The meeting room is already booked in Google Calendar for one of the requested times.",

            conflictingStart:
              occurrence.start.toISOString(),

            conflictingEnd:
              occurrence.end.toISOString(),
          },
          {
            status: 409,
          },
        );
      }
    }

    // -------------------------------------------------------------------------
    // CUSTOMER
    // -------------------------------------------------------------------------

    let customerId =
      body.customerId;

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
          {
            status: 400,
          },
        );
      }

      const [
        customer,
      ] = await db
        .insert(customers)
        .values({
          name:
            body.customerName.trim(),
          phone:
            body.customerPhone.trim(),
        })
        .returning({
          id: customers.id,
        });

      customerId =
        customer.id;
    }

    // -------------------------------------------------------------------------
    // GOOGLE RECURRENCE
    // -------------------------------------------------------------------------

    const recurrenceRule =
      recurrence ===
      "weekly"
        ? `RRULE:FREQ=WEEKLY;COUNT=${count}`
        : undefined;

    const googleEvent =
      await createGoogleCalendarEvent(
        mapping.calendarId,
        {
          summary:
            `WorkSpace Hub - ${room.name} - ${body.customerName?.trim() || "Reservation"}`,

          description:
            body.notes?.trim() ||
            `Customer: ${
              body.customerName?.trim() ||
              "Customer"
            }`,

          start:
            start.toISOString(),

          end:
            end.toISOString(),

          recurrenceRule,

          recurrenceCount:
            count,
        },
      );

    if (
      !googleEvent.id
    ) {
      throw new Error(
        "Google Calendar event was created without an ID.",
      );
    }

    createdGoogleEvent =
      googleEvent.id;

    createdCalendarId =
      mapping.calendarId;

    // -------------------------------------------------------------------------
    // LOCAL RESERVATION
    // -------------------------------------------------------------------------

    const [
      reservation,
    ] = await db
      .insert(
        meetingRoomReservations,
      )
      .values({
        deskId:
          room.id,

        customerId,

        userId:
          user.id,

        startAt:
          start,

        endAt:
          end,

        recurrenceRule,

        recurrenceCount:
          count > 1
            ? count
            : null,

        googleEventId:
          googleEvent.id,

        status:
          "confirmed",

        notes:
          body.notes?.trim() ||
          null,
      })
      .returning({
        id:
          meetingRoomReservations.id,
      });

    return NextResponse.json({
      ok: true,

      reservationId:
        reservation.id,

      googleEventId:
        googleEvent.id,

      googleCalendarId:
        mapping.calendarId,

      roomName:
        room.name,

      startAt:
        start.toISOString(),

      endAt:
        end.toISOString(),

      recurrence,
      recurrenceCount:
        count,
    });
  } catch (error) {
    console.error(
      "Create meeting room reservation error:",
      error,
    );

    if (
      createdGoogleEvent &&
      createdCalendarId
    ) {
      try {
        await deleteGoogleCalendarEvent(
          createdCalendarId,
          createdGoogleEvent,
        );
      } catch (
        rollbackError
      ) {
        console.error(
          "Google event rollback failed:",
          rollbackError,
        );
      }
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not create meeting room reservation.",
      },
      {
        status: 500,
      },
    );
  }
}