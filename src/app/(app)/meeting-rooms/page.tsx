import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import {
  customers,
  desks,
  meetingRoomPricing,
  meetingRoomReservations,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { getActiveShiftForUser } from "@/lib/shift";
import { loadTimezone } from "@/lib/timezone";

import MeetingRoomsHub from "./MeetingRoomsHub";

export const dynamic = "force-dynamic";

function intSetting(raw: string, fallback: number, min: number, max: number) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export default async function MeetingRoomsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const activeShift = await getActiveShiftForUser(user.id);
  if (!activeShift) redirect("/shift");

  const timeZone = await loadTimezone();
  const now = new Date();
  const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const [currency, earlyRaw, maxRaw, rooms, pricingRows, reservationRows] =
    await Promise.all([
      getSetting("currency"),
      getSetting("meeting_room_early_checkin_minutes"),
      getSetting("meeting_room_max_booking_hours"),
      db
        .select({
          id: desks.id,
          name: desks.name,
          hourlyRate: desks.hourlyRate,
          capacity: desks.capacity,
        })
        .from(desks)
        .where(and(eq(desks.active, true), eq(desks.type, "meeting_room")))
        .orderBy(asc(desks.sortOrder)),
      db
        .select({
          id: meetingRoomPricing.id,
          deskId: meetingRoomPricing.deskId,
          minPeople: meetingRoomPricing.minPeople,
          maxPeople: meetingRoomPricing.maxPeople,
          hourlyRate: meetingRoomPricing.hourlyRate,
          active: meetingRoomPricing.active,
        })
        .from(meetingRoomPricing)
        .orderBy(
          asc(meetingRoomPricing.deskId),
          asc(meetingRoomPricing.minPeople),
        ),
      db
        .select({
          id: meetingRoomReservations.id,
          deskId: meetingRoomReservations.deskId,
          roomName: desks.name,
          customerName: customers.name,
          customerPhone: customers.phone,
          startAt: meetingRoomReservations.startAt,
          endAt: meetingRoomReservations.endAt,
          status: meetingRoomReservations.status,
          attendeeCount: meetingRoomReservations.attendeeCount,
          packagePurchaseId: meetingRoomReservations.packagePurchaseId,
        })
        .from(meetingRoomReservations)
        .innerJoin(desks, eq(desks.id, meetingRoomReservations.deskId))
        .innerJoin(
          customers,
          eq(customers.id, meetingRoomReservations.customerId),
        )
        .where(
          and(
            inArray(meetingRoomReservations.status, ["confirmed", "active"]),
            gte(meetingRoomReservations.endAt, now),
            lte(meetingRoomReservations.startAt, horizon),
          ),
        )
        .orderBy(asc(meetingRoomReservations.startAt))
        .limit(200),
    ]);

  return (
    <MeetingRoomsHub
      rooms={rooms.map((room) => ({
        ...room,
        pricingTiers: pricingRows
          .filter((tier) => tier.deskId === room.id)
          .map((tier) => ({
            id: tier.id,
            minPeople: tier.minPeople,
            maxPeople: tier.maxPeople,
            hourlyRate: tier.hourlyRate,
            active: tier.active,
          })),
      }))}
      reservations={reservationRows.map((r) => ({
        id: r.id,
        deskId: r.deskId,
        roomName: r.roomName,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
        status: r.status as "confirmed" | "active",
        attendeeCount: r.attendeeCount,
        usesPackage: r.packagePurchaseId !== null,
      }))}
      currency={currency}
      timeZone={timeZone}
      earlyCheckinMinutes={intSetting(earlyRaw, 30, 0, 1440)}
      maxBookingHours={intSetting(maxRaw, 8, 1, 24)}
    />
  );
}
