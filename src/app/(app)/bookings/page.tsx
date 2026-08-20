import { db } from "@/db";
import { desks, bookings, customers } from "@/db/schema";
import { and, eq, isNull, asc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getActiveShiftForUser } from "@/lib/shift";
import { getSetting, formatMoney } from "@/lib/settings";
import DeskGrid from "./DeskGrid";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const activeShift = await getActiveShiftForUser(user.id);
  if (!activeShift) redirect("/shift");
  const currency = await getSetting("currency");

  const allDesks = await db
    .select()
    .from(desks)
    .where(and(eq(desks.active, true), eq(desks.type, "desk")))
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

  const occupancyMap = new Map<number, (typeof active)[number]>();
  for (const b of active) occupancyMap.set(b.deskId, b);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Desk Bookings</h1>
          <p className="text-slate-500">
            Click any desk to check-in a customer or manage an active booking.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/meeting-rooms" className="btn btn-ghost">
            Meeting Rooms →
          </Link>
        </div>
      </div>

      <div className="flex gap-4 flex-wrap">
        <Legend color="bg-emerald-100 text-emerald-800" label={`Available ${allDesks.length - occupancyMap.size}`} />
        <Legend color="bg-red-100 text-red-800" label={`Occupied ${occupancyMap.size}`} />
      </div>

      <DeskGrid
        desks={allDesks.map((d) => ({
          id: d.id,
          name: d.name,
          hourlyRate: d.hourlyRate,
          type: d.type,
        }))}
        occupancy={Object.fromEntries(
          Array.from(occupancyMap.entries()).map(([k, v]) => [
            k,
            {
              id: v.id,
              customerName: v.customerName,
              customerPhone: v.customerPhone,
              checkedInAt: v.checkedInAt.toISOString(),
              hourlyRate: v.hourlyRate,
            },
          ]),
        )}
        currency={currency}
      />
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className={`px-3 py-1.5 rounded-full text-xs font-semibold ${color}`}>
      {label}
    </div>
  );
}

// Suppress unused warning
void formatMoney;
