import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { customers, desks, meetingRoomReservations } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { loadTimezone } from "@/lib/timezone";

import MeetingRoomCalendar from "./MeetingRoomCalendar";

export const dynamic = "force-dynamic";

function intSetting(raw: string, fallback: number, min: number, max: number) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export default async function MeetingRoomCalendarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const timeZone = await loadTimezone();

  const [
    currency,
    startRaw,
    endRaw,
    maxRaw,
    weekRaw,
    earlyRaw,
    rooms,
  ] = await Promise.all([
    getSetting("currency"),
    getSetting("calendar_start_hour"),
    getSetting("calendar_end_hour"),
    getSetting("meeting_room_max_booking_hours"),
    getSetting("calendar_week_starts_on"),
    getSetting("meeting_room_early_checkin_minutes"),
    db
      .select({
        id: desks.id,
        name: desks.name,
        hourlyRate: desks.hourlyRate,
        capacity: desks.capacity,
      })
      .from(desks)
      .where(and(eq(desks.type, "meeting_room"), eq(desks.active, true)))
      .orderBy(asc(desks.sortOrder)),
  ]);

  const startHour = intSetting(startRaw, 8, 0, 23);
  let endHour = intSetting(endRaw, 23, 1, 24);
  if (endHour <= startHour) endHour = Math.min(24, startHour + 1);

  // Two weeks back (to show what already happened) to three months ahead.
  const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const to = new Date(Date.now() + 92 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: meetingRoomReservations.id,
      deskId: meetingRoomReservations.deskId,
      roomName: desks.name,
      customerName: customers.name,
      customerPhone: customers.phone,
      startAt: meetingRoomReservations.startAt,
      endAt: meetingRoomReservations.endAt,
      status: meetingRoomReservations.status,
      notes: meetingRoomReservations.notes,
      attendeeCount: meetingRoomReservations.attendeeCount,
      packagePurchaseId: meetingRoomReservations.packagePurchaseId,
    })
    .from(meetingRoomReservations)
    .innerJoin(desks, eq(desks.id, meetingRoomReservations.deskId))
    .innerJoin(customers, eq(customers.id, meetingRoomReservations.customerId))
    .where(
      and(
        inArray(meetingRoomReservations.status, [
          "confirmed",
          "active",
          "closed",
        ]),
        gte(meetingRoomReservations.endAt, from),
        lte(meetingRoomReservations.startAt, to),
      ),
    )
    .orderBy(asc(meetingRoomReservations.startAt))
    .limit(2000);

  return (
    <MeetingRoomCalendar
      rooms={rooms}
      reservations={rows.map((r) => ({
        id: r.id,
        deskId: r.deskId,
        roomName: r.roomName,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
        status: r.status,
        notes: r.notes,
        attendeeCount: r.attendeeCount,
        usesPackage: r.packagePurchaseId !== null,
      }))}
      startHour={startHour}
      endHour={endHour}
      maxBookingHours={intSetting(maxRaw, 8, 1, 24)}
      currency={currency}
      timeZone={timeZone}
      weekStartsOn={intSetting(weekRaw, 0, 0, 6)}
      earlyCheckinMinutes={intSetting(earlyRaw, 30, 0, 1440)}
    />
  );
}
