import { db } from "@/db";
import {
  meetingRoomReservations,
  desks,
  customers,
} from "@/db/schema";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import MeetingRoomCalendar from "./MeetingRoomCalendar";

export const dynamic = "force-dynamic";

export default async function MeetingRoomCalendarPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const rooms = await db
    .select({
      id: desks.id,
      name: desks.name,
      hourlyRate: desks.hourlyRate,
    })
    .from(desks)
    .where(
      and(
        eq(desks.type, "meeting_room"),
        eq(desks.active, true),
      ),
    )
    .orderBy(asc(desks.sortOrder));

  const now = new Date();

  const reservations = await db
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
    })
    .from(meetingRoomReservations)
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
    )
    .orderBy(
      asc(meetingRoomReservations.startAt),
    );

  return (
    <MeetingRoomCalendar
      rooms={rooms.map((room) => ({
        id: room.id,
        name: room.name,
        hourlyRate: room.hourlyRate,
      }))}
      reservations={reservations.map(
        (reservation) => ({
          id: reservation.id,
          deskId: reservation.deskId,
          roomName: reservation.roomName,
          customerName:
            reservation.customerName,
          customerPhone:
            reservation.customerPhone,
          startAt:
            reservation.startAt.toISOString(),
          endAt:
            reservation.endAt.toISOString(),
          status: reservation.status,
          notes: reservation.notes,
        }),
      )}
    />
  );
}