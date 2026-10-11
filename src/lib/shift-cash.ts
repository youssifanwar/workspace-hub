import { sql } from "drizzle-orm";

import type { db } from "@/db";

/**
 * Cash that entered the drawer during a shift from sources OTHER than
 * session checkouts and direct café sales (those are summed separately by
 * the shift pages/routes):
 *
 *  - desk packages and meeting-room packages paid in cash
 *  - manual income paid in cash
 *  - customer balance top-ups paid in cash
 *
 * Package/balance payments made with visa or instapay never touch the
 * drawer, and payments made FROM a customer balance are not new money
 * (the cash arrived when the balance was topped up).
 *
 * Works with either `db` or a transaction handle.
 */
export async function getShiftExtraCash(
  executor: Pick<typeof db, "execute">,
  shiftId: number,
): Promise<{
  packages: number;
  manualIncome: number;
  balanceDeposits: number;
  total: number;
}> {
  const result = await executor.execute(sql`
    SELECT
      (
        SELECT COALESCE(SUM(price_snapshot), 0)
        FROM customer_subscriptions
        WHERE shift_id = ${shiftId}
          AND payment_method = 'cash'
          AND status <> 'cancelled'
      ) +
      (
        SELECT COALESCE(SUM(price_snapshot), 0)
        FROM customer_meeting_room_packages
        WHERE shift_id = ${shiftId}
          AND payment_method = 'cash'
          AND status <> 'cancelled'
      ) AS packages,
      (
        SELECT COALESCE(SUM(amount), 0)
        FROM manual_incomes
        WHERE shift_id = ${shiftId}
          AND payment_method = 'cash'
      ) AS manual_income,
      (
        SELECT COALESCE(SUM(amount), 0)
        FROM customer_balance_transactions
        WHERE shift_id = ${shiftId}
          AND type = 'deposit'
          AND payment_method = 'cash'
      ) AS balance_deposits
  `);

  const row = (
    result as { rows?: Array<Record<string, unknown>> }
  ).rows?.[0];

  const packages = Number(row?.packages ?? 0);
  const manualIncome = Number(row?.manual_income ?? 0);
  const balanceDeposits = Number(row?.balance_deposits ?? 0);

  return {
    packages,
    manualIncome,
    balanceDeposits,
    total:
      Math.round((packages + manualIncome + balanceDeposits) * 100) / 100,
  };
}
