import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookings, bookingItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shift = await getActiveShiftForUser(user.id);
  if (!shift) return NextResponse.json({ error: "No active shift" }, { status: 400 });

  const bookingId = Number(id);
  const body = (await req.json()) as {
    paymentMethod?: "cash" | "visa" | "instapay";
    paidAmount?: number;
    discount?: number;
  };
  if (!body.paymentMethod)
    return NextResponse.json({ error: "paymentMethod required" }, { status: 400 });

  const [b] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!b || b.status === "closed")
    return NextResponse.json({ error: "Booking not open" }, { status: 400 });

  const items = await db
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId));

  const ordersTotal = items.reduce(
    (s, i) => s + i.quantity * parseFloat(i.unitPrice),
    0,
  );

  const closedAt = new Date();
  const durationH = Math.max(
    0,
    (closedAt.getTime() - b.checkedInAt.getTime()) / 3_600_000,
  );
  const seatCharge = durationH * parseFloat(b.hourlyRateSnapshot);
  const discount = Math.max(0, Number(body.discount || 0));
  const total = Math.max(0, seatCharge + ordersTotal - discount);
  const paid = Math.max(0, Number(body.paidAmount || 0));
  const change = body.paymentMethod === "cash" ? Math.max(0, paid - total) : 0;

  if (body.paymentMethod === "cash" && paid < total) {
    return NextResponse.json(
      { error: "Insufficient cash paid" },
      { status: 400 },
    );
  }

  await db
    .update(bookings)
    .set({
      checkedOutAt: closedAt,
      seatCharge: seatCharge.toFixed(2),
      ordersTotal: ordersTotal.toFixed(2),
      discount: discount.toFixed(2),
      total: total.toFixed(2),
      paidAmount: paid.toFixed(2),
      changeAmount: change.toFixed(2),
      paymentMethod: body.paymentMethod,
      status: "closed",
    })
    .where(eq(bookings.id, bookingId));

  return NextResponse.json({ ok: true, total, change });
}
