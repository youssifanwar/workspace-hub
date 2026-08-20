import { NextResponse } from "next/server";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shift = await getActiveShiftForUser(user.id);
  if (!shift) return NextResponse.json({ error: "No active shift" }, { status: 400 });

  const body = (await req.json()) as {
    amount?: number;
    category?: string;
    note?: string;
  };
  if (!body.amount || body.amount <= 0)
    return NextResponse.json({ error: "Positive amount required" }, { status: 400 });

  await db.insert(expenses).values({
    shiftId: shift.id,
    userId: user.id,
    amount: body.amount.toFixed(2),
    category: body.category?.trim() || "General",
    note: body.note || null,
  });
  return NextResponse.json({ ok: true });
}
