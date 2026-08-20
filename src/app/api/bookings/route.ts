import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookings, customers, desks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shift = await getActiveShiftForUser(user.id);
  if (!shift)
    return NextResponse.json({ error: "No active shift" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as {
    deskId?: number;
    customerName?: string;
    customerPhone?: string;
    customerId?: number;
  } | null;
  if (!body?.deskId)
    return NextResponse.json({ error: "deskId required" }, { status: 400 });

  const deskRows = await db
    .select()
    .from(desks)
    .where(eq(desks.id, body.deskId))
    .limit(1);
  const desk = deskRows[0];
  if (!desk)
    return NextResponse.json({ error: "Desk not found" }, { status: 404 });

  // Prevent double-booking
  const existing = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(eq(bookings.deskId, desk.id), eq(bookings.status, "active")),
    )
    .limit(1);
  if (existing.length > 0)
    return NextResponse.json(
      { error: "This desk is already occupied" },
      { status: 400 },
    );

  let customerId = body.customerId;
  if (!customerId) {
    if (!body.customerName?.trim() || !body.customerPhone?.trim())
      return NextResponse.json(
        { error: "Customer name and phone required" },
        { status: 400 },
      );
    const [cust] = await db
      .insert(customers)
      .values({
        name: body.customerName.trim(),
        phone: body.customerPhone.trim(),
      })
      .returning();
    customerId = cust.id;
  }

  const [booking] = await db
    .insert(bookings)
    .values({
      customerId,
      deskId: desk.id,
      shiftId: shift.id,
      userId: user.id,
      hourlyRateSnapshot: desk.hourlyRate,
    })
    .returning();

  return NextResponse.json({ ok: true, bookingId: booking.id });
}
