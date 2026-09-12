import { db } from "@/db";
import { desks } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSetting } from "@/lib/settings";
import RoomsGrid from "./RoomsGrid";

export const dynamic = "force-dynamic";

export default async function MeetingRoomsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const currency = await getSetting("currency");

  const rooms = await db
    .select({
      id: desks.id,
      name: desks.name,
      hourlyRate: desks.hourlyRate,
    })
    .from(desks)
    .where(eq(desks.type, "meeting_room"))
    .orderBy(asc(desks.sortOrder));

  const canEditRate =
    user.role === "admin" ||
    user.role === "manager";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">
          Meeting Rooms
        </h1>

        <p className="text-slate-500 mt-1">
          Manage meeting rooms, pricing and reservations.
        </p>
      </div>

      {rooms.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="text-5xl mb-4">
            👥
          </div>

          <h2 className="text-xl font-bold text-slate-900">
            No meeting rooms
          </h2>

          <p className="text-slate-500 mt-2">
            Add a meeting room to start managing reservations.
          </p>
        </div>
      ) : (
        <RoomsGrid
          rooms={rooms}
          currency={currency}
          canEditRate={canEditRate}
        />
      )}
    </div>
  );
}