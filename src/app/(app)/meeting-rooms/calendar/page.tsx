import { db } from "@/db";

import {
  meetingRoomReservations,
  desks,
  customers,
} from "@/db/schema";

import {
  and,
  asc,
  eq,
  gte,
  or,
} from "drizzle-orm";

import {
  getCurrentUser,
} from "@/lib/auth";

import { redirect } from "next/navigation";

import { getSetting } from "@/lib/settings";
import MeetingRoomCalendar from "./MeetingRoomCalendar";

export const dynamic =
  "force-dynamic";

export default async function MeetingRoomCalendarPage() {
  const user =
    await getCurrentUser();

  if (!user) {
    redirect(
      "/login",
    );
  }

  const rooms =
    await db
      .select({
        id:
          desks.id,

        name:
          desks.name,

        hourlyRate:
          desks.hourlyRate,
        capacity:
          desks.capacity,
      })
      .from(
        desks,
      )
      .where(
        and(
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
      .orderBy(
        asc(
          desks.sortOrder,
        ),
      );

  const [startRaw, endRaw, maxRaw] = await Promise.all([
    getSetting("calendar_start_hour"),
    getSetting("calendar_end_hour"),
    getSetting("meeting_room_max_booking_hours"),
  ]);
  let startHour = Number(startRaw);
  let endHour = Number(endRaw);
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) startHour = 8;
  if (!Number.isInteger(endHour) || endHour <= startHour || endHour > 24) endHour = Math.max(startHour + 1, 23);
  let maxBookingHours = Number(maxRaw);
  if (!Number.isInteger(maxBookingHours) || maxBookingHours < 1 || maxBookingHours > 24) maxBookingHours = 8;

  const now =
    new Date();

  const reservations =
    await db
      .select({
        id:
          meetingRoomReservations.id,

        deskId:
          meetingRoomReservations.deskId,

        roomName:
          desks.name,

        customerName:
          customers.name,

        customerPhone:
          customers.phone,

        startAt:
          meetingRoomReservations.startAt,

        endAt:
          meetingRoomReservations.endAt,

        status:
          meetingRoomReservations.status,

        notes:
          meetingRoomReservations.notes,
      })
      .from(
        meetingRoomReservations,
      )
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
      .where(
        or(
          eq(
            meetingRoomReservations.status,
            "active",
          ),

          and(
            eq(
              meetingRoomReservations.status,
              "confirmed",
            ),

            gte(
              meetingRoomReservations.endAt,
              now,
            ),
          ),
        ),
      )
      .orderBy(
        asc(
          meetingRoomReservations.startAt,
        ),
      );

  return (
    <MeetingRoomCalendar
      rooms={rooms.map(
        (room) => ({
          id:
            room.id,

          name:
            room.name,

          hourlyRate:
            room.hourlyRate,
          capacity:
            room.capacity,
        }),
      )}
      startHour={startHour}
      endHour={endHour}
      maxBookingHours={maxBookingHours}
      reservations={reservations.map(
        (reservation) => ({
          id:
            reservation.id,

          deskId:
            reservation.deskId,

          roomName:
            reservation.roomName,

          customerName:
            reservation.customerName,

          customerPhone:
            reservation.customerPhone,

          startAt:
            reservation.startAt.toISOString(),

          endAt:
            reservation.endAt.toISOString(),

          status:
            reservation.status,

          notes:
            reservation.notes,
        }),
      )}
    />
  );
}