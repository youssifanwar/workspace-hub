import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { customers, memberships } from "@/db/schema";
import { canManage, getCurrentUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

async function guard() {
  const user = await getCurrentUser();
  if (!user) return { err: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if ((await getSetting("feature_memberships")) !== "1") {
    return { err: NextResponse.json({ error: "Memberships are turned off in Settings." }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const g = await guard();
  if (g.err) return g.err;
  const rows = await db
    .select({
      id: memberships.id,
      customerId: memberships.customerId,
      customerName: customers.name,
      planName: memberships.planName,
      monthlyPrice: memberships.monthlyPrice,
      status: memberships.status,
      nextBillingDate: memberships.nextBillingDate,
      lastChargedAt: memberships.lastChargedAt,
      note: memberships.note,
    })
    .from(memberships)
    .innerJoin(customers, eq(customers.id, memberships.customerId))
    .orderBy(desc(memberships.id))
    .limit(300);
  return NextResponse.json({ memberships: rows });
}

export async function POST(req: Request) {
  const g = await guard();
  if (g.err) return g.err;
  if (!canManage(g.user!.role)) {
    return NextResponse.json({ error: "Only managers can create memberships." }, { status: 403 });
  }
  const b = (await req.json().catch(() => null)) as {
    customerId?: unknown;
    planName?: unknown;
    monthlyPrice?: unknown;
    firstBillingDate?: unknown;
    note?: unknown;
  } | null;
  const customerId = Number(b?.customerId);
  const price = Number(b?.monthlyPrice);
  const plan = typeof b?.planName === "string" ? b.planName.trim().slice(0, 120) : "";
  const first =
    typeof b?.firstBillingDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.firstBillingDate)
      ? b.firstBillingDate
      : null;
  if (!Number.isSafeInteger(customerId) || customerId <= 0 || !plan || !Number.isFinite(price) || price <= 0 || price > 1_000_000) {
    return NextResponse.json({ error: "Customer, plan name and a price above 0 are required." }, { status: 400 });
  }
  const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!c) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const [row] = await db
    .insert(memberships)
    .values({
      customerId,
      planName: plan,
      monthlyPrice: price.toFixed(2),
      nextBillingDate: first ?? sql`current_date`,
      note: typeof b?.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null,
      createdByUserId: g.user!.id,
    })
    .returning({ id: memberships.id });
  return NextResponse.json({ ok: true, id: row.id });
}
