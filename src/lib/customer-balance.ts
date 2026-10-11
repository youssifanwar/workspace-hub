import { eq } from "drizzle-orm";

import type { db } from "@/db";
import {
  customerBalanceTransactions,
  customers,
} from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class BalanceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BalanceError";
    this.status = status;
  }
}

export type BalanceChange = {
  customerId: number;
  /** Positive adds money to the account, negative spends it. */
  delta: number;
  type: "deposit" | "payment" | "refund" | "adjustment";
  paymentMethod?: "cash" | "visa" | "instapay" | null;
  shiftId?: number | null;
  userId?: number | null;
  bookingId?: number | null;
  note?: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The ONLY place a customer's balance is changed. Must run inside a
 * transaction: it locks the customer row, refuses to go below zero, updates
 * the balance and writes the matching ledger row atomically, so the balance
 * and its history can never drift apart.
 */
export async function applyBalanceChange(
  tx: Tx,
  change: BalanceChange,
): Promise<{ balanceAfter: number }> {
  const delta = round2(change.delta);
  if (!Number.isFinite(delta) || delta === 0) {
    throw new BalanceError("Amount must be a non-zero number.");
  }

  const [customer] = await tx
    .select({ id: customers.id, balance: customers.balance })
    .from(customers)
    .where(eq(customers.id, change.customerId))
    .for("update")
    .limit(1);

  if (!customer) throw new BalanceError("Customer not found.", 404);

  const before = Number(customer.balance);
  const after = round2(before + delta);

  if (after < 0) {
    throw new BalanceError(
      `Not enough balance. Available: ${before.toFixed(2)}, needed: ${Math.abs(delta).toFixed(2)}.`,
      409,
    );
  }

  await tx
    .update(customers)
    .set({ balance: after.toFixed(2) })
    .where(eq(customers.id, customer.id));

  await tx.insert(customerBalanceTransactions).values({
    customerId: customer.id,
    type: change.type,
    amount: delta.toFixed(2),
    balanceAfter: after.toFixed(2),
    paymentMethod: change.paymentMethod ?? null,
    shiftId: change.shiftId ?? null,
    userId: change.userId ?? null,
    bookingId: change.bookingId ?? null,
    note: change.note ?? null,
  });

  return { balanceAfter: after };
}
