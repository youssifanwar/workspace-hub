import { db } from "@/db";
import { desks, meetingRoomPricing } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { getCurrentUser, canManage } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getActiveShiftForUser } from "@/lib/shift";
import { getSetting } from "@/lib/settings";
import RoomsGrid from "./RoomsGrid";
import ActiveMeetingRooms from "./ActiveMeetingRooms";

export const dynamic = "force-dynamic";

export default async function MeetingRoomsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const activeShift = await getActiveShiftForUser(user.id);
  if (!activeShift) redirect("/shift");
  const currency = await getSetting("currency");
  const rooms = await db.select({ id: desks.id, name: desks.name, hourlyRate: desks.hourlyRate, capacity: desks.capacity, sortOrder: desks.sortOrder }).from(desks).where(and(eq(desks.active, true), eq(desks.type, "meeting_room"))).orderBy(asc(desks.sortOrder));
  const pricingRows = await db.select({ id: meetingRoomPricing.id, deskId: meetingRoomPricing.deskId, minPeople: meetingRoomPricing.minPeople, maxPeople: meetingRoomPricing.maxPeople, hourlyRate: meetingRoomPricing.hourlyRate, active: meetingRoomPricing.active }).from(meetingRoomPricing).orderBy(asc(meetingRoomPricing.deskId), asc(meetingRoomPricing.minPeople), asc(meetingRoomPricing.maxPeople));
  const roomsWithPricing = rooms.map((room) => ({ ...room, pricingTiers: pricingRows.filter((tier) => tier.deskId === room.id).map((tier) => ({ id: tier.id, minPeople: tier.minPeople, maxPeople: tier.maxPeople, hourlyRate: tier.hourlyRate, active: tier.active })) }));
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Meeting Rooms</h1>
          <p className="text-slate-500 mt-1">
            Book meeting rooms by the hour. Pricing is based on the room and number of people.
            {canManage(user.role) ? "" : " Ask a manager to update room pricing."}
          </p>
        </div>

        <Link
          href="/meeting-rooms/calendar"
          className="btn btn-primary inline-flex items-center justify-center gap-2 shrink-0"
        >
          📅 Calendar
        </Link>
      </div>

      <ActiveMeetingRooms currency={currency} />
      <RoomsGrid
        rooms={roomsWithPricing}
        currency={currency}
        canEditRate={canManage(user.role)}
      />
    </div>
  );
}