import { sql } from "drizzle-orm";

import type { db } from "@/db";

/**
 * Cash expected in the drawer right now for one shift. Same formula the
 * "My shift" page uses: opening cash + cash revenue (sessions, direct F&B,
 * packages, manual income) + cash balance top-ups - cash expenses - bank
 * deposits + bank withdrawals. Read-only; used only for warnings.
 */
export async function getExpectedDrawerCash(
  executor: Pick<typeof db, "execute">,
  shiftId: number,
  openingCash: number,
): Promise<number> {
  const result = await executor.execute(sql`
    SELECT
      (
        SELECT COALESCE(SUM(total), 0) FROM bookings
        WHERE shift_id = ${shiftId} AND status = 'closed' AND payment_method = 'cash'
      ) + (
        SELECT COALESCE(SUM(total), 0) FROM fnb_sales
        WHERE shift_id = ${shiftId} AND payment_method = 'cash'
      ) + (
        SELECT COALESCE(SUM(price_snapshot), 0) FROM customer_subscriptions
        WHERE shift_id = ${shiftId} AND status <> 'cancelled' AND payment_method = 'cash'
      ) + (
        SELECT COALESCE(SUM(price_snapshot), 0) FROM customer_meeting_room_packages
        WHERE shift_id = ${shiftId} AND status <> 'cancelled' AND payment_method = 'cash'
      ) + (
        SELECT COALESCE(SUM(amount), 0) FROM manual_incomes
        WHERE shift_id = ${shiftId} AND payment_method = 'cash'
      ) + (
        SELECT COALESCE(SUM(amount), 0) FROM customer_balance_transactions
        WHERE shift_id = ${shiftId} AND type = 'deposit' AND payment_method = 'cash'
      ) - (
        SELECT COALESCE(SUM(amount), 0) FROM expenses
        WHERE shift_id = ${shiftId} AND payment_method = 'cash'
      ) - (
        SELECT COALESCE(SUM(amount), 0) FROM bank_transactions
        WHERE shift_id = ${shiftId} AND type = 'deposit'
      ) + (
        SELECT COALESCE(SUM(amount), 0) FROM bank_transactions
        WHERE shift_id = ${shiftId} AND type = 'withdraw'
      ) AS cash
  `);
  const row = (result as { rows?: Array<Record<string, unknown>> }).rows?.[0];
  const n = Number(row?.cash ?? 0);
  return Math.round((openingCash + (Number.isFinite(n) ? n : 0)) * 100) / 100;
}
