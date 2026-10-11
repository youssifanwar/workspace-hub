import { NextResponse } from "next/server";
import { ilike, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookings, customers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Live customer search used by autocomplete boxes (name or phone, partial
 * match). Returns at most 8 matches, newest customers first.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const term = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (term.length < 2) {
    return NextResponse.json({ customers: [] });
  }

  const digits = term.replace(/\D/g, "");
  const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);

  try {
    const rows = await db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
        balance: customers.balance,
      })
      .from(customers)
      .where(
        or(
          ilike(customers.name, `%${escaped}%`),
          ilike(customers.phone, `%${escaped}%`),
          digits ? ilike(customers.phoneNormalized, `%${digits}%`) : undefined,
        ),
      )
      .orderBy(customers.name)
      .limit(8);

    // Visits + total hours spent (desk and meeting-room sessions).
    const ids = rows.map((r) => r.id);
    const statRows =
      ids.length === 0
        ? []
        : await db
            .select({
              customerId: bookings.customerId,
              visits: sql<number>`count(*)::int`,
              hours: sql<string>`coalesce(sum(greatest(0, extract(epoch from (coalesce(${bookings.checkedOutAt}, now()) - ${bookings.checkedInAt})) / 3600)), 0)`,
            })
            .from(bookings)
            .where(inArray(bookings.customerId, ids))
            .groupBy(bookings.customerId);
    const stats = new Map(statRows.map((r) => [r.customerId, r]));

    return NextResponse.json({
      customers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        balance: Number(r.balance),
        visits: stats.get(r.id)?.visits ?? 0,
        totalHours: Math.round(Number(stats.get(r.id)?.hours ?? 0) * 10) / 10,
      })),
    });
  } catch (error) {
    console.error("Customer search error:", error);
    return NextResponse.json(
      { error: "Search failed." },
      { status: 500 },
    );
  }
}
