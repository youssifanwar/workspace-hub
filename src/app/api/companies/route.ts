import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { companies, companyMembers, customers, guestPasses } from "@/db/schema";
import { canManage, getCurrentUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const id = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * Body: { action: "create_company" | "add_member" | "remove_member" |
 * "add_guest" | "delete_guest", ... }. Records only; never touches balances.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await getSetting("feature_companies")) !== "1") {
    return NextResponse.json({ error: "Company accounts are turned off in Settings." }, { status: 403 });
  }
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = str(b?.action, 30);
  try {
    if (action === "add_guest") {
      const host = id(b?.hostCustomerId);
      const name = str(b?.guestName, 160);
      if (!host || !name) return NextResponse.json({ error: "Host customer and guest name are required." }, { status: 400 });
      const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, host)).limit(1);
      if (!c) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
      await db.insert(guestPasses).values({
        hostCustomerId: host, guestName: name, guestPhone: str(b?.guestPhone, 40) || null,
        note: str(b?.note, 500) || null, createdByUserId: user.id,
      });
      return NextResponse.json({ ok: true });
    }
    if (!canManage(user.role)) {
      return NextResponse.json({ error: "Only managers can change companies." }, { status: 403 });
    }
    if (action === "create_company") {
      const name = str(b?.name, 160);
      if (!name) return NextResponse.json({ error: "Company name is required." }, { status: 400 });
      await db.insert(companies).values({ name, contactPhone: str(b?.contactPhone, 40) || null, note: str(b?.note, 500) || null });
      return NextResponse.json({ ok: true });
    }
    if (action === "add_member" || action === "remove_member") {
      const companyId = id(b?.companyId);
      const customerId = id(b?.customerId);
      if (!companyId || !customerId) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
      if (action === "add_member") {
        await db.insert(companyMembers).values({ companyId, customerId }).onConflictDoNothing();
      } else {
        await db.delete(companyMembers).where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.customerId, customerId)));
      }
      return NextResponse.json({ ok: true });
    }
    if (action === "delete_guest") {
      const gid = id(b?.id);
      if (!gid) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
      await db.delete(guestPasses).where(eq(guestPasses.id, gid));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Could not save. Has optional-migrations/003 been run?" }, { status: 500 });
  }
}
