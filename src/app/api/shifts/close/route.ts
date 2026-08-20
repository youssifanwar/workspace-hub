import { NextResponse } from "next/server";
import { db } from "@/db";
import { shifts, bookings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const active = await getActiveShiftForUser(user.id);
  if (!active) {
    return NextResponse.json(
      { error: "No active shift to close" },
      { status: 400 },
    );
  }

  // Ensure no active bookings under this shift
  const openBookings = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shiftId, active.id), eq(bookings.status, "active")));
  if (openBookings.length > 0) {
    return NextResponse.json(
      {
        error: `Cannot close shift: ${openBookings.length} booking(s) are still active. Please check them out first.`,
      },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    closingCash?: number;
    note?: string;
  } | null;
  const closingCash = Number(body?.closingCash ?? 0);
  const note = body?.note?.trim() || null;

  const updateData: {
    closedAt: Date;
    closingCash: string;
    note?: string;
  } = {
    closedAt: new Date(),
    closingCash: closingCash.toFixed(2),
  };
  if (note) updateData.note = note;

  await db.update(shifts).set(updateData).where(eq(shifts.id, active.id));

  return NextResponse.json({ ok: true, shiftId: active.id });
}
