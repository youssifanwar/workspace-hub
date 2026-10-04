import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { auditLogs, customers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0020")) return `20${digits.slice(4)}`;
  if (digits.startsWith("20")) return digits;
  if (digits.startsWith("0")) return `20${digits.slice(1)}`;
  return digits;
}

/**
 * Register a new customer without opening a session or selling a package.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    phone?: unknown;
    email?: unknown;
    notes?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email =
    typeof body.email === "string" && body.email.trim()
      ? body.email.trim().toLowerCase()
      : null;
  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim().slice(0, 2000)
      : null;

  if (!name || name.length > 200) {
    return NextResponse.json(
      { error: "Customer name is required (max 200 characters)." },
      { status: 400 },
    );
  }
  const phoneNormalized = normalizePhone(phone);
  if (phoneNormalized.length < 8 || phoneNormalized.length > 20) {
    return NextResponse.json(
      { error: "A valid phone number is required." },
      { status: 400 },
    );
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${phoneNormalized}, 0))`,
      );

      const [existing] = await tx
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(eq(customers.phoneNormalized, phoneNormalized))
        .limit(1);
      if (existing) return { duplicate: existing } as const;

      const [created] = await tx
        .insert(customers)
        .values({ name, phone, phoneNormalized, email, notes })
        .returning({ id: customers.id, name: customers.name });

      await tx.insert(auditLogs).values({
        userId: user.id,
        action: "customer_created",
        entityType: "customer",
        entityId: created.id,
        details: { name, phone, phoneNormalized, email },
      });
      return { created } as const;
    });

    if ("duplicate" in result && result.duplicate) {
      return NextResponse.json(
        {
          error: `A customer with this phone already exists: ${result.duplicate.name} (#${result.duplicate.id}).`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: true, customer: "created" in result ? result.created : null },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create customer error:", error);
    return NextResponse.json(
      { error: "Could not create customer." },
      { status: 500 },
    );
  }
}
