import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  desks,
  meetingRoomCalendars,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import {
  getCalendarBusyPeriods,
} from "@/lib/google-calendar";

export const dynamic =
  "force-dynamic";

export async function GET(
  req: Request,
) {
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

    const url =
      new URL(req.url);

    const deskId =
      Number(
        url.searchParams.get(
          "deskId",
        ),
      );

    const startAt =
      url.searchParams.get(
        "startAt",
      );

    const endAt =
      url.searchParams.get(
        "endAt",
      );

    if (
      !Number.isInteger(
        deskId,
      ) ||
      deskId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid room.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !startAt ||
      !endAt
    ) {
      return NextResponse.json(
        {
          error:
            "Start and end are required.",
        },
        {
          status: 400,
        },
      );
    }

    const start =
      new Date(startAt);

    const end =
      new Date(endAt);

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
            "Invalid time range.",
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
          deskId,
        ),
      )
      .limit(1);

    if (!mapping) {
      return NextResponse.json(
        {
          error:
            "This meeting room is not linked to Google Calendar yet.",
        },
        {
          status: 400,
        },
      );
    }

    const busy =
      await getCalendarBusyPeriods(
        mapping.calendarId,
        start.toISOString(),
        end.toISOString(),
      );

    return NextResponse.json({
      available:
        busy.length === 0,

      room: {
        id: room.id,
        name: room.name,
      },

      busy,
    });
  } catch (error) {
    console.error(
      "Meeting room availability error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Could not check Google Calendar availability.",
      },
      {
        status: 500,
      },
    );
  }
}