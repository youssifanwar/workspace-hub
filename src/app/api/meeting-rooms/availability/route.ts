import { NextResponse } from "next/server";

import {
  and,
  eq,
  gt,
  lt,
} from "drizzle-orm";

import { db } from "@/db";

import {
  desks,
  meetingRoomCalendars,
  meetingRoomReservations,
} from "@/db/schema";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  getCalendarBusyPeriods,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;

const MAX_RECURRING_OCCURRENCES = 52;

/* ============================================================================
 * HELPERS
 * ========================================================================== */

function parsePositiveInteger(
  value: string | null,
): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    return null;
  }

  return parsed;
}

function parseDate(
  value: string | null,
): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function addDays(
  date: Date,
  days: number,
): Date {
  const result = new Date(date);

  result.setDate(
    result.getDate() + days,
  );

  return result;
}

function buildOccurrenceDates(
  start: Date,
  end: Date,
  recurrence: "none" | "weekly",
  count: number,
): Array<{
  start: Date;
  end: Date;
}> {
  if (recurrence === "none") {
    return [
      {
        start: new Date(start),
        end: new Date(end),
      },
    ];
  }

  const result: Array<{
    start: Date;
    end: Date;
  }> = [];

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    result.push({
      start: addDays(
        start,
        index * 7,
      ),
      end: addDays(
        end,
        index * 7,
      ),
    });
  }

  return result;
}

/* ============================================================================
 * GET
 * ========================================================================== */

export async function GET(
  req: Request,
) {
  try {
    /* -----------------------------------------------------------------------
     * AUTH
     * --------------------------------------------------------------------- */

    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    /* -----------------------------------------------------------------------
     * QUERY
     * --------------------------------------------------------------------- */

    const url = new URL(req.url);

    const deskId = parsePositiveInteger(
      url.searchParams.get("deskId"),
    );

    const startAtRaw =
      url.searchParams.get("startAt");

    const endAtRaw =
      url.searchParams.get("endAt");

    const recurrenceRaw =
      url.searchParams.get("recurrence");

    const recurrence =
      recurrenceRaw === "weekly"
        ? "weekly"
        : "none";

    const requestedCount =
      parsePositiveInteger(
        url.searchParams.get(
          "recurrenceCount",
        ),
      ) ?? 1;

    /* -----------------------------------------------------------------------
     * BASIC VALIDATION
     * --------------------------------------------------------------------- */

    if (!deskId) {
      return NextResponse.json(
        {
          available: false,
          error: "Invalid room.",
        },
        {
          status: 400,
        },
      );
    }

    if (!startAtRaw || !endAtRaw) {
      return NextResponse.json(
        {
          available: false,
          error:
            "Start and end are required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      recurrence === "weekly" &&
      (
        requestedCount < 1 ||
        requestedCount >
          MAX_RECURRING_OCCURRENCES
      )
    ) {
      return NextResponse.json(
        {
          available: false,
          error:
            `Weekly recurrence count must be between 1 and ${MAX_RECURRING_OCCURRENCES}.`,
        },
        {
          status: 400,
        },
      );
    }

    if (
      recurrence === "none" &&
      requestedCount !== 1
    ) {
      return NextResponse.json(
        {
          available: false,
          error:
            "Recurrence count can only be greater than 1 for weekly recurrence.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------------------------
     * DATE PARSING
     * --------------------------------------------------------------------- */

    const start = parseDate(startAtRaw);

    const end = parseDate(endAtRaw);

    if (!start || !end) {
      return NextResponse.json(
        {
          available: false,
          error:
            "Invalid start or end date.",
        },
        {
          status: 400,
        },
      );
    }

    if (end <= start) {
      return NextResponse.json(
        {
          available: false,
          error:
            "Invalid time range.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------------------------
     * FUTURE CHECK
     * --------------------------------------------------------------------- */

    const now = new Date();

    if (start <= now) {
      return NextResponse.json(
        {
          available: false,
          error:
            "Reservation must be in the future.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------------------------
     * WHOLE-HOUR CHECK
     *
     * 1h   ✅
     * 2h   ✅
     * 3h   ✅
     *
     * 1.5h ❌
     * 2.5h ❌
     * --------------------------------------------------------------------- */

    const durationMs =
      end.getTime() -
      start.getTime();

    if (durationMs <= 0) {
      return NextResponse.json(
        {
          available: false,
          error:
            "Invalid reservation duration.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      durationMs % HOUR_MS !== 0
    ) {
      return NextResponse.json(
        {
          available: false,
          error:
            "Meeting room reservations must use whole hours only. 1:30 bookings are not allowed.",
        },
        {
          status: 400,
        },
      );
    }

    const durationHours =
      durationMs / HOUR_MS;

    if (
      !Number.isInteger(durationHours) ||
      durationHours <= 0
    ) {
      return NextResponse.json(
        {
          available: false,
          error:
            "Invalid reservation duration.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------------------------
     * ROOM
     * --------------------------------------------------------------------- */

    const [room] =
      await db
        .select({
          id: desks.id,
          name: desks.name,
          type: desks.type,
          active: desks.active,
          capacity: desks.capacity,
        })
        .from(desks)
        .where(
          and(
            eq(
              desks.id,
              deskId,
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
          available: false,
          error:
            "Meeting room not found or inactive.",
        },
        {
          status: 404,
        },
      );
    }

    if (
      !Number.isInteger(room.capacity) ||
      room.capacity <= 0
    ) {
      return NextResponse.json(
        {
          available: false,
          error:
            "Meeting room capacity is not configured correctly.",
        },
        {
          status: 500,
        },
      );
    }

    /* -----------------------------------------------------------------------
     * OCCURRENCES
     * --------------------------------------------------------------------- */

    const occurrences =
      buildOccurrenceDates(
        start,
        end,
        recurrence,
        recurrence === "weekly"
          ? requestedCount
          : 1,
      );

    /* -----------------------------------------------------------------------
     * FUTURE CHECK FOR ALL OCCURRENCES
     * --------------------------------------------------------------------- */

    for (const occurrence of occurrences) {
      if (occurrence.start <= now) {
        return NextResponse.json(
          {
            available: false,
            error:
              "One of the requested reservation occurrences is no longer in the future.",
          },
          {
            status: 400,
          },
        );
      }
    }

    /* -----------------------------------------------------------------------
     * GOOGLE CALENDAR MAPPING
     * --------------------------------------------------------------------- */

    const [mapping] =
      await db
        .select({
          calendarId:
            meetingRoomCalendars.calendarId,

          calendarName:
            meetingRoomCalendars.calendarName,
        })
        .from(meetingRoomCalendars)
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
          available: false,
          error:
            "This meeting room is not linked to Google Calendar yet.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------------------------
     * INTERNAL DATABASE CONFLICT CHECK
     *
     * This catches confirmed reservations that already exist in our DB.
     *
     * The final reservation endpoint MUST repeat this check inside its
     * reservation flow. This endpoint is an availability preview only.
     * --------------------------------------------------------------------- */

    for (
      const occurrence of occurrences
    ) {
      const conflicts =
        await db
          .select({
            id:
              meetingRoomReservations.id,

            startAt:
              meetingRoomReservations.startAt,

            endAt:
              meetingRoomReservations.endAt,
          })
          .from(
            meetingRoomReservations,
          )
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
        const conflict =
          conflicts[0];

        return NextResponse.json(
          {
            available: false,

            reason:
              "internal_conflict",

            message:
              "The meeting room is already reserved in the system for one of the requested times.",

            room: {
              id: room.id,
              name: room.name,
              capacity:
                room.capacity,
            },

            conflictingStart:
              conflict.startAt.toISOString(),

            conflictingEnd:
              conflict.endAt.toISOString(),
          },
          {
            status: 409,
          },
        );
      }
    }

    /* -----------------------------------------------------------------------
     * GOOGLE CALENDAR CONFLICT CHECK
     * --------------------------------------------------------------------- */

    for (
      const occurrence of occurrences
    ) {
      let busy;

      try {
        busy =
          await getCalendarBusyPeriods(
            mapping.calendarId,
            occurrence.start.toISOString(),
            occurrence.end.toISOString(),
          );
      } catch (googleError) {
        console.error(
          "Google Calendar availability check failed:",
          googleError,
        );

        return NextResponse.json(
          {
            available: false,
            error:
              "Could not verify Google Calendar availability. The reservation was not approved.",
          },
          {
            status: 502,
          },
        );
      }

      if (busy.length > 0) {
        return NextResponse.json(
          {
            available: false,

            reason:
              "google_conflict",

            message:
              "The meeting room is already busy in Google Calendar for one of the requested times.",

            room: {
              id: room.id,
              name: room.name,
              capacity:
                room.capacity,
            },

            conflictingStart:
              occurrence.start.toISOString(),

            conflictingEnd:
              occurrence.end.toISOString(),

            busy,
          },
          {
            status: 409,
          },
        );
      }
    }

    /* -----------------------------------------------------------------------
     * AVAILABLE
     * --------------------------------------------------------------------- */

    return NextResponse.json({
      available: true,

      room: {
        id: room.id,

        name: room.name,

        capacity:
          room.capacity,
      },

      calendar: {
        calendarId:
          mapping.calendarId,

        calendarName:
          mapping.calendarName ?? null,
      },

      durationHours,

      recurrence,

      recurrenceCount:
        recurrence === "weekly"
          ? requestedCount
          : 1,

      occurrences:
        occurrences.map(
          (occurrence) => ({
            startAt:
              occurrence.start.toISOString(),

            endAt:
              occurrence.end.toISOString(),
          }),
        ),

      busy: [],
    });
  } catch (error) {
    console.error(
      "Meeting room availability error:",
      error,
    );

    return NextResponse.json(
      {
        available: false,

        error:
          error instanceof Error
            ? error.message
            : "Could not check meeting room availability.",
      },
      {
        status: 500,
      },
    );
  }
}