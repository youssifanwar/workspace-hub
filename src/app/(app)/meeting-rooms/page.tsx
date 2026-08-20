import { db } from "@/db";
import { desks, bookings, customers } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { getCurrentUser, canManage } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getActiveShiftForUser } from "@/lib/shift";
import { getSetting } from "@/lib/settings";
import RoomsGrid from "./RoomsGrid";

export const dynamic = "force-dynamic";

export default async function MeetingRoomsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const activeShift = await getActiveShiftForUser(user.id);
  if (!activeShift) redirect("/shift");
  const currency = await getSetting("currency");

  const rooms = await db
    .select()
    .from(desks)
    .where(and(eq(desks.active, true), eq(desks.type, "meeting_room")))
    .orderBy(asc(desks.sortOrder));

  const active = await db
    .select({
      id: bookings.id,
      deskId: bookings.deskId,
      customerName: customers.name,
      customerPhone: customers.phone,
      checkedInAt: bookings.checkedInAt,
      hourlyRate: bookings.hourlyRateSnapshot,
    })
    .from(bookings)
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .where(eq(bookings.status, "active"));

  const occ: Record<
    number,
    {
      id: number;
      customerName: string;
      customerPhone: string;
      checkedInAt: string;
      hourlyRate: string;
    }
  > = {};
  for (const b of active) {
    occ[b.deskId] = {
      id: b.id,
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      checkedInAt: b.checkedInAt.toISOString(),
      hourlyRate: b.hourlyRate,
    };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Meeting Rooms</h1>
        <p className="text-slate-500">
          Book meeting rooms by the hour. {canManage(user.role) ? "You can edit hourly rates directly on each card." : "Ask a manager to update the hourly rates."}
        </p>
      </div>

      <RoomsGrid
        rooms={rooms.map((r) => ({
          id: r.id,
          name: r.name,
          hourlyRate: r.hourlyRate,
        }))}
        occupancy={occ}
        currency={currency}
        canEditRate={canManage(user.role)}
      />
    </div>
  );
}
