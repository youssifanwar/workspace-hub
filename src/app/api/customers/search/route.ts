import { NextResponse } from "next/server";
import { ilike, or } from "drizzle-orm";

import { db } from "@/db";
import { customers } from "@/db/schema";
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

    return NextResponse.json({ customers: rows });
  } catch (error) {
    console.error("Customer search error:", error);
    return NextResponse.json(
      { error: "Search failed." },
      { status: 500 },
    );
  }
}
