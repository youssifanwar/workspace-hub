import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  auditLogs,
  bankTransactions,
  bookings,
  expenses,
  shifts,
  users,
} from "@/db/schema";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getShiftExtraCash } from "@/lib/shift-cash";

export const dynamic = "force-dynamic";

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function parseOptionalMoney(
  value: unknown,
  label: string,
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ApiError(`${label} must be a valid, non-negative number.`, 400);
  }
  return Math.round(amount * 100) / 100;
}

/**
 * Hands the currently open, system-wide shift from whoever has it open to
 * another active employee, in one atomic step — without requiring every
 * customer currently sitting in the space to be checked out first.
 *
 * Regular shift close (`/api/shifts/close`) intentionally blocks while any
 * booking is still active, because closing the register for the day really
 * should force a final reconciliation. A handover is different: the
 * business stays open, a customer may still be mid-session, and the point
 * is simply to swap who is responsible for the till. So this endpoint:
 *
 *  1. Moves every currently active session (open-seating AND meeting-room)
 *     from the outgoing shift to a newly created incoming shift, so none
 *     of them are interrupted.
 *  2. Closes the outgoing shift with a cash count, the same reconciliation
 *     math used by the normal close endpoint.
 *  3. Opens a new shift for the incoming employee, defaulting its opening
 *     cash to the outgoing shift's closing cash (same physical drawer)
 *     unless a different amount is explicitly counted.
 *
 * Either the outgoing employee themself, or an admin, can perform this —
 * covering the case an employee doesn't know how to do it and a manager
 * needs to step in.
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as {
      toUsername?: unknown;
      closingCash?: unknown;
      openingCash?: unknown;
      note?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const toUsername =
      typeof body.toUsername === "string" ? body.toUsername.trim() : "";
    if (!toUsername) {
      return NextResponse.json(
        { error: "Choose who is taking over the shift." },
        { status: 400 },
      );
    }

    const note =
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, 500)
        : null;

    const result = await db.transaction(async (tx) => {
      // Same fixed lock key used by open/close, so a handover can't race
      // with someone opening or closing a shift at the same moment.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(727274001)`);

      const [openShift] = await tx
        .select({
          id: shifts.id,
          userId: shifts.userId,
          openedAt: shifts.openedAt,
          openingCash: shifts.openingCash,
        })
        .from(shifts)
        .where(sql`${shifts.closedAt} IS NULL`)
        .limit(1)
        .for("update");

      if (!openShift) {
        throw new ApiError("There is no open shift to hand over.", 409);
      }

      if (openShift.userId !== user.id && !isAdmin(user.role)) {
        throw new ApiError(
          "Only the employee currently on shift, or an admin, can hand it over.",
          403,
        );
      }

      const [toUser] = await tx
        .select({ id: users.id, fullName: users.fullName, active: users.active })
        .from(users)
        .where(eq(users.username, toUsername))
        .limit(1);

      if (!toUser) {
        throw new ApiError(`No account found for "${toUsername}".`, 404);
      }
      if (!toUser.active) {
        throw new ApiError(`${toUser.fullName}'s account is disabled.`, 400);
      }
      if (toUser.id === openShift.userId) {
        throw new ApiError(
          "That is the same employee who already has the shift open.",
          400,
        );
      }

      /* ---------------------------------------------------------------- */
      /* CASH RECONCILIATION FOR THE OUTGOING SHIFT                        */
      /* Identical math to /api/shifts/close, so the numbers always agree. */
      /* ---------------------------------------------------------------- */
      const [bookingCashRow] = await tx
        .select({
          total: sql<string>`coalesce(sum(${bookings.total}), 0)`,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.shiftId, openShift.id),
            eq(bookings.status, "closed"),
            eq(bookings.paymentMethod, "cash"),
          ),
        );

      const directFnbCashResult = await tx.execute(
        sql`SELECT COALESCE(SUM(total), 0) AS total FROM fnb_sales WHERE shift_id = ${openShift.id} AND payment_method = 'cash'`,
      );
      const directFnbCashRow = (
        directFnbCashResult as { rows?: Array<Record<string, unknown>> }
      ).rows?.[0];

      const [expensesRow] = await tx
        .select({
          total: sql<string>`coalesce(sum(${expenses.amount}), 0)`,
        })
        .from(expenses)
        .where(eq(expenses.shiftId, openShift.id));

      const [bankRow] = await tx
        .select({
          deposits: sql<string>`coalesce(sum(case when ${bankTransactions.type} = 'deposit' then ${bankTransactions.amount} else 0 end), 0)`,
          withdrawals: sql<string>`coalesce(sum(case when ${bankTransactions.type} = 'withdraw' then ${bankTransactions.amount} else 0 end), 0)`,
        })
        .from(bankTransactions)
        .where(eq(bankTransactions.shiftId, openShift.id));

      const openingCashOutgoing = Number(openShift.openingCash ?? 0);
      const extraCash = await getShiftExtraCash(tx, openShift.id);
      const cashSales =
        Number(bookingCashRow?.total ?? 0) +
        Number(directFnbCashRow?.total ?? 0) +
        extraCash.total;
      const expenseTotal = Number(expensesRow?.total ?? 0);
      const bankDeposits = Number(bankRow?.deposits ?? 0);
      const bankWithdrawals = Number(bankRow?.withdrawals ?? 0);

      const expectedCash =
        Math.round(
          (openingCashOutgoing +
            cashSales -
            expenseTotal -
            bankDeposits +
            bankWithdrawals) *
            100,
        ) / 100;

      const closingCash =
        parseOptionalMoney(body.closingCash, "Closing cash") ?? expectedCash;
      const openingCashIncoming =
        parseOptionalMoney(body.openingCash, "Opening cash") ?? closingCash;

      /* ---------------------------------------------------------------- */
      /* CREATE THE INCOMING SHIFT FIRST                                   */
      /* ---------------------------------------------------------------- */
      const [newShift] = await tx
        .insert(shifts)
        .values({
          userId: toUser.id,
          openingCash: openingCashIncoming.toFixed(2),
        })
        .returning({ id: shifts.id, openedAt: shifts.openedAt });

      if (!newShift) {
        throw new ApiError("Could not open the incoming shift.", 500);
      }

      /* ---------------------------------------------------------------- */
      /* MOVE EVERY ACTIVE SESSION TO THE NEW SHIFT, UNINTERRUPTED         */
      /* ---------------------------------------------------------------- */
      const movedBookings = await tx
        .update(bookings)
        .set({ shiftId: newShift.id })
        .where(
          and(
            eq(bookings.shiftId, openShift.id),
            eq(bookings.status, "active"),
          ),
        )
        .returning({ id: bookings.id });

      /* ---------------------------------------------------------------- */
      /* CLOSE THE OUTGOING SHIFT                                          */
      /* ---------------------------------------------------------------- */
      const closedAt = new Date();
      const [closedShift] = await tx
        .update(shifts)
        .set({
          closedAt,
          closingCash: closingCash.toFixed(2),
          note: note ?? sql`${shifts.note}`,
        })
        .where(
          and(eq(shifts.id, openShift.id), sql`${shifts.closedAt} IS NULL`),
        )
        .returning({ id: shifts.id, closedAt: shifts.closedAt });

      if (!closedShift) {
        throw new ApiError(
          "The outgoing shift changed before the handover could complete.",
          409,
        );
      }

      await tx.insert(auditLogs).values({
        userId: user.id,
        action: "shift_handover",
        entityType: "shift",
        entityId: openShift.id,
        details: {
          fromUserId: openShift.userId,
          toUserId: toUser.id,
          newShiftId: newShift.id,
          movedBookingIds: movedBookings.map((b) => b.id),
          closingCash,
          openingCashIncoming,
          expectedCash,
          difference: Math.round((closingCash - expectedCash) * 100) / 100,
        },
      });

      return {
        closedShiftId: openShift.id,
        newShiftId: newShift.id,
        toUserFullName: toUser.fullName,
        movedSessions: movedBookings.length,
        closingCash,
        openingCashIncoming,
        expectedCash,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Shift handover error:", error);
    return NextResponse.json(
      { error: "Could not hand over the shift." },
      { status: 500 },
    );
  }
}
