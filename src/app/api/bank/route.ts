import { NextResponse } from "next/server";
import { db } from "@/db";
import { bankTransactions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shift = await getActiveShiftForUser(user.id);
  if (!shift) return NextResponse.json({ error: "No active shift" }, { status: 400 });

  const body = (await req.json()) as {
    type?: "deposit" | "withdraw";
    amount?: number;
    note?: string;
  };
  if (!body.type || !body.amount || body.amount <= 0)
    return NextResponse.json(
      { error: "type and positive amount required" },
      { status: 400 },
    );

  await db.insert(bankTransactions).values({
    shiftId: shift.id,
    userId: user.id,
    type: body.type,
    amount: body.amount.toFixed(2),
    note: body.note || null,
  });
  return NextResponse.json({ ok: true });
}
