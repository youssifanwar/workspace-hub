import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  meetingRoomCalendars,
  meetingRoomReservations,
} from "@/db/schema";
import {
  eq,
} from "drizzle-orm";
import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";
import {
  deleteGoogleCalendarEvent,
} from "@/lib/google-calendar";

export async function DELETE(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
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

    if (
      !canManage(
        user.role,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Permission denied.",
        },
        {
          status: 403,
        },
      );
    }

    const {
      id,
    } = await params;

    const reservationId =
      Number(id);

    if (
      !Number.isInteger(
        reservationId,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid reservation id.",
        },
        {
          status: 400,
        },
      );
    }

    const [
      reservation,
    ] = await db
      .select()
      .from(
        meetingRoomReservations,
      )
      .where(
        eq(
          meetingRoomReservations.id,
          reservationId,
        ),
      )
      .limit(1);

    if (!reservation) {
      return NextResponse.json(
        {
          error:
            "Reservation not found.",
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
      })
      .from(
        meetingRoomCalendars,
      )
      .where(
        eq(
          meetingRoomCalendars.deskId,
          reservation.deskId,
        ),
      )
      .limit(1);

    if (
      mapping &&
      reservation.googleEventId
    ) {
      await deleteGoogleCalendarEvent(
        mapping.calendarId,
        reservation.googleEventId,
      );
    }

    await db
      .delete(
        meetingRoomReservations,
      )
      .where(
        eq(
          meetingRoomReservations.id,
          reservationId,
        ),
      );

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "Delete meeting room reservation error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Could not cancel reservation.",
      },
      {
        status: 500,
      },
    );
  }
}