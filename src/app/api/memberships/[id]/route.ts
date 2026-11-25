import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { membershipRoomCredits, memberships } from "@/db/schema";
import { canManage, getCurrentUser } from "@/lib/auth";
import { applyBalanceChange, BalanceError } from "@/lib/customer-balance";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Body: { action: "pause" | "resume" | "cancel" | "charge" } */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await getSetting("feature_memberships")) !== "1") {
    return NextResponse.json({ error: "Memberships are turned off in Settings." }, { status: 403 });
  }
  if (!canManage(user.role)) {
    return NextResponse.json({ error: "Only managers can change memberships." }, { status: 403 });
  }
  const id = Number((await params).id);
  const b = (await req.json().catch(() => null)) as { action?: unknown; hours?: unknown } | null;
  const action = typeof b?.action === "string" ? b.action : "";
  if (!Number.isSafeInteger(id) || id <= 0 || !["pause", "resume", "cancel", "charge", "use_room_hours"].includes(action)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    await db.transaction(async (tx) => {
      const [m] = await tx.select().from(memberships).where(eq(memberships.id, id)).for("update").limit(1);
      if (!m) throw new BalanceError("Membership not found.", 404);
      if (m.status === "cancelled") throw new BalanceError("This membership is cancelled.", 409);

      if (action === "use_room_hours") {
        const h = Number(b?.hours);
        if (!Number.isFinite(h) || h <= 0 || h > 744) throw new BalanceError("Enter hours above 0.", 400);
        const [{ bal }] = (await tx.execute(
          sql`select coalesce(sum(hours_delta),0)::float as bal from membership_room_credits where membership_id = ${id}`,
        ).then((r) => (r as unknown as { rows: Array<{ bal: number }> }).rows.map((x) => ({ bal: Number(x.bal) }))));
        if (h > bal + 1e-9) throw new BalanceError(`Only ${bal} room hours left.`, 409);
        await tx.insert(membershipRoomCredits).values({
          membershipId: id, hoursDelta: (-h).toFixed(2), reason: "use", userId: user.id,
        });
        return;
      }

      if (action === "charge") {
        if (m.status !== "active") throw new BalanceError("Only an active membership can be charged.", 409);
        const [due] = await tx.execute(
          sql`select (${m.nextBillingDate}::date <= current_date) as due`,
        ).then((r) => (r as unknown as { rows: Array<{ due: boolean }> }).rows);
        if (!due?.due) throw new BalanceError("Not due yet. The next billing date is in the future.", 409);
        await applyBalanceChange(tx, {
          customerId: m.customerId,
          delta: -Number(m.monthlyPrice),
          type: "payment",
          userId: user.id,
          allowDebt: true,
          note: `Membership: ${m.planName}`,
        });
        await tx
          .update(memberships)
          .set({
            nextBillingDate: sql`${memberships.nextBillingDate} + interval '1 month'`,
            lastChargedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(memberships.id, id));
        if (Number(m.includedRoomHours) > 0) {
          await tx.insert(membershipRoomCredits).values({
            membershipId: id, hoursDelta: Number(m.includedRoomHours).toFixed(2), reason: "grant", userId: user.id,
          });
        }
        return;
      }
      const status = action === "pause" ? "paused" : action === "resume" ? "active" : "cancelled";
      await tx.update(memberships).set({ status, updatedAt: sql`now()` }).where(eq(memberships.id, id));
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BalanceError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Could not update the membership." }, { status: 500 });
  }
}
