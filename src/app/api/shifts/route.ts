import { NextResponse } from "next/server";
import { db } from "@/db";
import { shifts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await getActiveShiftForUser(user.id);
  if (existing) {
    return NextResponse.json(
      { error: "You already have an active shift" },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    openingCash?: number;
    note?: string;
  } | null;
  const openingCash = Number(body?.openingCash ?? 0);
  const note = body?.note?.trim() || null;

  const [row] = await db
    .insert(shifts)
    .values({
      userId: user.id,
      openingCash: openingCash.toFixed(2),
      note,
    })
    .returning();

  return NextResponse.json({ ok: true, shiftId: row.id });
}
