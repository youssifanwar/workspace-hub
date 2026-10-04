import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { auditLogs, manualIncomes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export const dynamic = "force-dynamic";

const MAX_AMOUNT = 9_999_999_999.99;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    amount?: unknown;
    category?: unknown;
    note?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return NextResponse.json(
      { error: "Positive valid amount is required." },
      { status: 400 },
    );
  }

  const category =
    typeof body.category === "string" ? body.category.trim() : "";
  if (!category || category.length > 100) {
    return NextResponse.json(
      { error: "Category must be between 1 and 100 characters." },
      { status: 400 },
    );
  }

  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim()
      : null;
  if (note && note.length > 500) {
    return NextResponse.json({ error: "Note is too long." }, { status: 400 });
  }

  const shift = await getActiveShiftForUser(user.id);
  if (!shift) {
    return NextResponse.json(
      { error: "No active shift. Open a shift first." },
      { status: 400 },
    );
  }

  try {
    const created = await db.transaction(async (tx) => {
      // Lock the shift row so income can't be added while the shift closes.
      const locked = await tx.execute(
        sql`SELECT closed_at FROM shifts WHERE id = ${shift.id} AND user_id = ${user.id} FOR UPDATE`,
      );
      const row = locked.rows?.[0] as { closed_at?: unknown } | undefined;
      if (!row || row.closed_at !== null) {
        throw new Error("SHIFT_NOT_ACTIVE");
      }

      const [income] = await tx
        .insert(manualIncomes)
        .values({
          shiftId: shift.id,
          userId: user.id,
          amount: amount.toFixed(2),
          category,
          note,
        })
        .returning({ id: manualIncomes.id });

      await tx.insert(auditLogs).values({
        userId: user.id,
        action: "income_created",
        entityType: "income",
        entityId: income.id,
        details: { amount, category, note, shiftId: shift.id },
      });
      return income;
    });

    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SHIFT_NOT_ACTIVE") {
      return NextResponse.json(
        { error: "Your shift is no longer active." },
        { status: 409 },
      );
    }
    console.error("Create income error:", error);
    return NextResponse.json(
      { error: "Could not record the income." },
      { status: 500 },
    );
  }
}
