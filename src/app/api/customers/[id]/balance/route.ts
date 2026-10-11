import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { auditLogs, customerBalanceTransactions, customers } from "@/db/schema";
import { canManage, getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";
import { applyBalanceChange, BalanceError } from "@/lib/customer-balance";

export const dynamic = "force-dynamic";

const MAX_AMOUNT = 1_000_000;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customerId = Number((await params).id);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    return NextResponse.json({ error: "Invalid customer id." }, { status: 400 });
  }

  const [customer] = await db
    .select({ id: customers.id, name: customers.name, balance: customers.balance })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!customer) {
    return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }

  const transactions = await db
    .select({
      id: customerBalanceTransactions.id,
      type: customerBalanceTransactions.type,
      amount: customerBalanceTransactions.amount,
      balanceAfter: customerBalanceTransactions.balanceAfter,
      paymentMethod: customerBalanceTransactions.paymentMethod,
      note: customerBalanceTransactions.note,
      createdAt: customerBalanceTransactions.createdAt,
    })
    .from(customerBalanceTransactions)
    .where(eq(customerBalanceTransactions.customerId, customerId))
    .orderBy(desc(customerBalanceTransactions.createdAt))
    .limit(30);

  return NextResponse.json({
    customer: { id: customer.id, name: customer.name },
    balance: Number(customer.balance),
    transactions: transactions.map((t) => ({
      ...t,
      amount: Number(t.amount),
      balanceAfter: Number(t.balanceAfter),
      createdAt: t.createdAt.toISOString(),
    })),
  });
}

/**
 * Top up a customer's account (any staff with an open shift) or make a
 * manual correction (managers/admins only, note required).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const customerId = Number((await params).id);
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return NextResponse.json({ error: "Invalid customer id." }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as {
      type?: unknown;
      amount?: unknown;
      paymentMethod?: unknown;
      note?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

    const type = body.type === "adjustment" ? "adjustment" : "deposit";
    const amount = Number(body.amount);
    const note =
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, 500)
        : null;

    if (!Number.isFinite(amount) || Math.abs(amount) > MAX_AMOUNT) {
      return NextResponse.json({ error: "Enter a valid amount." }, { status: 400 });
    }

    if (type === "deposit") {
      if (amount <= 0) {
        return NextResponse.json(
          { error: "Top-up amount must be greater than 0." },
          { status: 400 },
        );
      }
      const method = body.paymentMethod;
      if (method !== "cash" && method !== "visa" && method !== "instapay") {
        return NextResponse.json(
          { error: "Choose how the customer paid (cash, visa or instapay)." },
          { status: 400 },
        );
      }

      const shift = await getActiveShiftForUser(user.id);
      if (!shift) {
        return NextResponse.json(
          { error: "Open a shift before taking a top-up." },
          { status: 400 },
        );
      }

      const result = await db.transaction(async (tx) => {
        const r = await applyBalanceChange(tx, {
          customerId,
          delta: amount,
          type: "deposit",
          paymentMethod: method,
          shiftId: shift.id,
          userId: user.id,
          note,
        });
        await tx.insert(auditLogs).values({
          userId: user.id,
          action: "customer_balance_deposit",
          entityType: "customer",
          entityId: customerId,
          details: { amount, paymentMethod: method, shiftId: shift.id },
        });
        return r;
      });
      return NextResponse.json({ ok: true, balance: result.balanceAfter }, { status: 201 });
    }

    // Manual adjustment
    if (!canManage(user.role)) {
      return NextResponse.json(
        { error: "Only managers/admins can adjust a balance manually." },
        { status: 403 },
      );
    }
    if (!note) {
      return NextResponse.json(
        { error: "A note explaining the adjustment is required." },
        { status: 400 },
      );
    }
    const result = await db.transaction(async (tx) => {
      const r = await applyBalanceChange(tx, {
        customerId,
        delta: amount,
        type: "adjustment",
        userId: user.id,
        note,
      });
      await tx.insert(auditLogs).values({
        userId: user.id,
        action: "customer_balance_adjustment",
        entityType: "customer",
        entityId: customerId,
        details: { amount, note },
      });
      return r;
    });
    return NextResponse.json({ ok: true, balance: result.balanceAfter }, { status: 201 });
  } catch (error) {
    if (error instanceof BalanceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Customer balance error:", error);
    return NextResponse.json({ error: "Could not update the balance." }, { status: 500 });
  }
}
