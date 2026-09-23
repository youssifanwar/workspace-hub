import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  shifts,
  bookings,
  bookingItems,
  expenses,
  bankTransactions,
  users,
  customers,
  desks,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getSetting, formatMoney } from "@/lib/settings";

import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

function safeNumber(value: unknown, fallback = 0): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number(value)
      : NaN;

  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeMoney(value: unknown): number {
  const parsed = safeNumber(value, 0);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100) / 100;
}

function safeDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(
  value: Date | string | null | undefined,
): string {
  const date = safeDate(value);

  return date ? date.toLocaleString() : "-";
}

function calculateDurationHours(
  checkedInAt: Date | string | null,
  checkedOutAt: Date | string | null,
): string {
  const start = safeDate(checkedInAt);
  const end = safeDate(checkedOutAt);

  if (!start || !end) {
    return "-";
  }

  const durationMs = end.getTime() - start.getTime();

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "-";
  }

  const durationHours = durationMs / 3_600_000;

  if (!Number.isFinite(durationHours)) {
    return "-";
  }

  return Math.max(0, durationHours).toFixed(2);
}

export default async function ShiftSummary({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const shiftId = Number(id);

  if (!Number.isSafeInteger(shiftId) || shiftId <= 0) {
    notFound();
  }

  const [currency, shiftRows] = await Promise.all([
    getSetting("currency"),

    db
      .select({
        id: shifts.id,
        openedAt: shifts.openedAt,
        closedAt: shifts.closedAt,
        openingCash: shifts.openingCash,
        closingCash: shifts.closingCash,
        note: shifts.note,
        userName: users.fullName,
      })
      .from(shifts)
      .innerJoin(users, eq(users.id, shifts.userId))
      .where(eq(shifts.id, shiftId))
      .limit(1),
  ]);

  const shiftRow = shiftRows[0];

  if (!shiftRow) {
    notFound();
  }

  const [
    totalsRow,
    methodRows,
    fnbTotalsRows,
    fnbMethodRows,
    expensesRows,
    bankRows,
    allBookings,
    topProducts,
    fnbTopProducts,
  ] = await Promise.all([
    db
      .select({
        revenue: sql<string>`
          coalesce(sum(${bookings.total}), 0)
        `,
        seat: sql<string>`
          coalesce(sum(${bookings.seatCharge}), 0)
        `,
        orders: sql<string>`
          coalesce(sum(${bookings.ordersTotal}), 0)
        `,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.shiftId, shiftId),
          eq(bookings.status, "closed"),
        ),
      ),

    db
      .select({
        method: bookings.paymentMethod,
        total: sql<string>`
          coalesce(sum(${bookings.total}), 0)
        `,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.shiftId, shiftId),
          eq(bookings.status, "closed"),
        ),
      )
      .groupBy(bookings.paymentMethod),

    db.execute(sql`
      SELECT
        COALESCE(SUM(total), 0) AS total,
        COALESCE(SUM(subtotal), 0) AS subtotal,
        COALESCE(SUM(discount), 0) AS discount
      FROM fnb_sales
      WHERE shift_id = ${shiftId}
    `),

    db.execute(sql`
      SELECT
        payment_method,
        COALESCE(SUM(total), 0) AS total
      FROM fnb_sales
      WHERE shift_id = ${shiftId}
      GROUP BY payment_method
    `),

    db
      .select({
        id: expenses.id,
        amount: expenses.amount,
        category: expenses.category,
        note: expenses.note,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .where(eq(expenses.shiftId, shiftId))
      .orderBy(desc(expenses.createdAt)),

    db
      .select({
        id: bankTransactions.id,
        type: bankTransactions.type,
        amount: bankTransactions.amount,
        note: bankTransactions.note,
        createdAt: bankTransactions.createdAt,
      })
      .from(bankTransactions)
      .where(eq(bankTransactions.shiftId, shiftId))
      .orderBy(desc(bankTransactions.createdAt)),

    db
      .select({
        id: bookings.id,
        customerName: customers.name,
        deskName: desks.name,
        total: bookings.total,
        paymentMethod: bookings.paymentMethod,
        checkedInAt: bookings.checkedInAt,
        checkedOutAt: bookings.checkedOutAt,
      })
      .from(bookings)
      .innerJoin(
        customers,
        eq(customers.id, bookings.customerId),
      )
      .innerJoin(
        desks,
        eq(desks.id, bookings.deskId),
      )
      .where(eq(bookings.shiftId, shiftId))
      .orderBy(desc(bookings.checkedInAt)),

    db
      .select({
        name: bookingItems.nameSnapshot,
        qty: sql<number>`
          sum(${bookingItems.quantity})::int
        `,
        revenue: sql<string>`
          coalesce(
            sum(
              ${bookingItems.quantity} *
              ${bookingItems.unitPrice}
            ),
            0
          )
        `,
      })
      .from(bookingItems)
      .innerJoin(
        bookings,
        eq(bookings.id, bookingItems.bookingId),
      )
      .where(eq(bookings.shiftId, shiftId))
      .groupBy(bookingItems.nameSnapshot)
      .orderBy(
        desc(sql`sum(${bookingItems.quantity})`),
      )
      .limit(6),

    db.execute(sql`
      SELECT
        name_snapshot AS name,
        COALESCE(SUM(quantity), 0)::int AS qty,
        COALESCE(SUM(quantity * unit_price), 0) AS revenue
      FROM fnb_sale_items
      WHERE sale_id IN (
        SELECT id
        FROM fnb_sales
        WHERE shift_id = ${shiftId}
      )
      GROUP BY name_snapshot
      ORDER BY SUM(quantity) DESC, name_snapshot ASC
      LIMIT 6
    `),
  ]);

  const bookingRevenue = safeMoney(
    totalsRow[0]?.revenue,
  );

  const seatTotal = safeMoney(
    totalsRow[0]?.seat,
  );

  const bookingOrdersTotal = safeMoney(
    totalsRow[0]?.orders,
  );

  const directFnbTotalsRow =
    (fnbTotalsRows as { rows?: Array<Record<string, unknown>> }).rows?.[0];

  const directFnbTotal = safeMoney(
    directFnbTotalsRow?.total,
  );

  const revenue = Math.round(
    (bookingRevenue + directFnbTotal) * 100,
  ) / 100;

  const ordersTotal = Math.round(
    (bookingOrdersTotal + directFnbTotal) * 100,
  ) / 100;

  const expensesTotal = expensesRows.reduce(
    (sum, expense) =>
      sum + safeMoney(expense.amount),
    0,
  );

  const bankDeposits = bankRows
    .filter(
      (transaction) =>
        transaction.type === "deposit",
    )
    .reduce(
      (sum, transaction) =>
        sum + safeMoney(transaction.amount),
      0,
    );

  const bankWithdrawals = bankRows
    .filter(
      (transaction) =>
        transaction.type === "withdraw",
    )
    .reduce(
      (sum, transaction) =>
        sum + safeMoney(transaction.amount),
      0,
    );

  const directFnbMethodRows =
    ((fnbMethodRows as { rows?: Array<Record<string, unknown>> }).rows ?? []);

  const directFnbPaymentTotal = (method: string) =>
    safeMoney(
      directFnbMethodRows.find(
        (row) => String(row.payment_method ?? "") === method,
      )?.total,
    );

  const cashTotal = Math.round(
    (safeMoney(
      methodRows.find(
        (method) => method.method === "cash",
      )?.total,
    ) + directFnbPaymentTotal("cash")) * 100,
  ) / 100;

  const visaTotal = Math.round(
    (safeMoney(
      methodRows.find(
        (method) => method.method === "visa",
      )?.total,
    ) + directFnbPaymentTotal("visa")) * 100,
  ) / 100;

  const instapayTotal = Math.round(
    (safeMoney(
      methodRows.find(
        (method) => method.method === "instapay",
      )?.total,
    ) + directFnbPaymentTotal("instapay")) * 100,
  ) / 100;

  const openingCash = safeMoney(
    shiftRow.openingCash,
  );

  const closingCash =
    shiftRow.closingCash !== null
      ? safeMoney(shiftRow.closingCash)
      : null;

  const expectedCash = Math.round(
    (
      openingCash +
      cashTotal -
      expensesTotal -
      bankDeposits +
      bankWithdrawals
    ) * 100,
  ) / 100;

  const diff =
    closingCash !== null
      ? Math.round(
          (closingCash - expectedCash) * 100,
        ) / 100
      : 0;

  const directFnbTopProducts =
    ((fnbTopProducts as { rows?: Array<Record<string, unknown>> }).rows ?? [])
      .map((row) => ({
        name: String(row.name ?? ""),
        qty: safeNumber(row.qty, 0),
        revenue: safeMoney(row.revenue),
      }));

  const combinedTopProducts = [...topProducts.map((row) => ({
    name: row.name,
    qty: safeNumber(row.qty, 0),
    revenue: safeMoney(row.revenue),
  })), ...directFnbTopProducts];

  const mergedTopProducts = Array.from(
    combinedTopProducts.reduce((map, item) => {
      const existing = map.get(item.name) ?? { name: item.name, qty: 0, revenue: 0 };
      existing.qty += item.qty;
      existing.revenue += item.revenue;
      map.set(item.name, existing);
      return map;
    }, new Map<string, { name: string; qty: number; revenue: number }>() ).values(),
  )
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
    .slice(0, 6);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3 no-print">
        <div>
          <h1 className="text-3xl font-bold">
            Shift #{shiftRow.id} Summary
          </h1>

          <p className="text-slate-500 text-sm">
            {shiftRow.userName || "Unknown user"} ·{" "}
            {formatDateTime(shiftRow.openedAt)}
            {shiftRow.closedAt
              ? ` → ${formatDateTime(
                  shiftRow.closedAt,
                )}`
              : ""}
          </p>
        </div>

        <div className="flex gap-2">
          <PrintButton />

          <Link
            href="/dashboard"
            className="btn btn-primary"
          >
            Dashboard →
          </Link>
        </div>
      </div>

      {shiftRow.note?.trim() && (
        <div className="card p-4">
          <div className="text-xs uppercase font-semibold text-slate-500 mb-1">
            Shift note
          </div>

          <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">
            {shiftRow.note}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-4 gap-4">
        <Kpi
          label="Total revenue"
          value={formatMoney(
            revenue,
            currency,
          )}
          grad="from-indigo-500 to-purple-500"
        />

        <Kpi
          label="Seat charges"
          value={formatMoney(
            seatTotal,
            currency,
          )}
          grad="from-cyan-500 to-blue-500"
        />

        <Kpi
          label="F&B sales"
          value={formatMoney(
            ordersTotal,
            currency,
          )}
          grad="from-orange-500 to-pink-500"
        />

        <Kpi
          label="Expenses"
          value={formatMoney(
            expensesTotal,
            currency,
          )}
          grad="from-rose-500 to-red-500"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="font-bold mb-4">
            Payment breakdown
          </h3>

          <Row
            label="💵 Cash"
            value={formatMoney(
              cashTotal,
              currency,
            )}
          />

          <Row
            label="💳 Visa"
            value={formatMoney(
              visaTotal,
              currency,
            )}
          />

          <Row
            label="📱 InstaPay"
            value={formatMoney(
              instapayTotal,
              currency,
            )}
          />

          <div className="h-px bg-slate-100 my-3" />

          <Row
            label="🏦 Bank deposits"
            value={formatMoney(
              bankDeposits,
              currency,
            )}
          />

          <Row
            label="🏦 Bank withdrawals"
            value={formatMoney(
              bankWithdrawals,
              currency,
            )}
          />
        </div>

        <div className="card p-6">
          <h3 className="font-bold mb-4">
            Cash drawer
          </h3>

          <Row
            label="Opening cash"
            value={formatMoney(
              openingCash,
              currency,
            )}
          />

          <Row
            label="+ Cash sales"
            value={formatMoney(
              cashTotal,
              currency,
            )}
          />

          <Row
            label="− Cash expenses"
            value={formatMoney(
              expensesTotal,
              currency,
            )}
          />

          <Row
            label="− Deposited"
            value={formatMoney(
              bankDeposits,
              currency,
            )}
          />

          <Row
            label="+ Withdrawn"
            value={formatMoney(
              bankWithdrawals,
              currency,
            )}
          />

          <div className="h-px bg-slate-100 my-3" />

          <Row
            label="Expected cash"
            value={formatMoney(
              expectedCash,
              currency,
            )}
          />

          {closingCash !== null && (
            <>
              <Row
                label="Counted cash"
                value={formatMoney(
                  closingCash,
                  currency,
                )}
              />

              <div
                className={`mt-3 p-3 rounded-xl text-sm font-semibold ${
                  Math.abs(diff) < 0.01
                    ? "bg-emerald-50 text-emerald-800"
                    : diff > 0
                    ? "bg-blue-50 text-blue-800"
                    : "bg-red-50 text-red-800"
                }`}
                aria-live="polite"
              >
                Difference:{" "}
                {diff >= 0 ? "+" : ""}
                {diff.toFixed(2)}{" "}
                {currency}
                {" · "}
                {Math.abs(diff) < 0.01
                  ? "Balanced"
                  : diff > 0
                  ? "Overage"
                  : "Shortage"}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card p-6">
        <h3 className="font-bold mb-4">
          Top selling items
        </h3>

        {mergedTopProducts.length === 0 ? (
          <p className="text-sm text-slate-400">
            No items sold in this shift
          </p>
        ) : (
          <div className="grid md:grid-cols-3 gap-3">
            {topProducts.map((product, index) => {
              const quantity = Math.max(
                0,
                safeNumber(product.qty, 0),
              );

              const itemRevenue = safeMoney(
                product.revenue,
              );

              return (
                <div
                  key={`${product.name}-${index}`}
                  className="p-4 rounded-xl border border-slate-200 flex items-center gap-3"
                >
                  <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 grid place-items-center font-bold shrink-0">
                    {index + 1}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">
                      {product.name || "Unnamed item"}
                    </div>

                    <div className="text-xs text-slate-500">
                      {quantity} sold ·{" "}
                      {formatMoney(
                        itemRevenue,
                        currency,
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card p-6">
        <h3 className="font-bold mb-4">
          Bookings ({allBookings.length})
        </h3>

        {allBookings.length === 0 ? (
          <p className="text-sm text-slate-400">
            No bookings in this shift
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase">
                  <th className="py-2">#</th>
                  <th>Customer</th>
                  <th>Desk / Room</th>
                  <th>Duration</th>
                  <th>Payment</th>
                  <th className="text-right">
                    Total
                  </th>
                </tr>
              </thead>

              <tbody>
                {allBookings.map((booking) => {
                  const duration = calculateDurationHours(
                    booking.checkedInAt,
                    booking.checkedOutAt,
                  );

                  const bookingTotal = safeMoney(
                    booking.total,
                  );

                  return (
                    <tr
                      key={booking.id}
                      className="border-t border-slate-100"
                    >
                      <td className="py-2">
                        {booking.id}
                      </td>

                      <td className="font-semibold">
                        {booking.customerName ||
                          "Unknown customer"}
                      </td>

                      <td>
                        {booking.deskName ||
                          "-"}
                      </td>

                      <td>
                        {duration === "-"
                          ? "-"
                          : `${duration} h`}
                      </td>

                      <td className="capitalize">
                        {booking.paymentMethod ||
                          "-"}
                      </td>

                      <td className="text-right font-bold">
                        {formatMoney(
                          bookingTotal,
                          currency,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="font-bold mb-4">
            Expenses ({expensesRows.length})
          </h3>

          {expensesRows.length === 0 ? (
            <p className="text-sm text-slate-400">
              No expenses
            </p>
          ) : (
            <div className="divide-soft">
              {expensesRows.map((expense) => (
                <div
                  key={expense.id}
                  className="py-2 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-sm">
                      {expense.category || "General"}
                    </div>

                    <div className="text-xs text-slate-500 truncate">
                      {expense.note || "-"}
                    </div>

                    <div className="text-xs text-slate-400 mt-0.5">
                      {formatDateTime(
                        expense.createdAt,
                      )}
                    </div>
                  </div>

                  <div className="font-bold text-red-600 shrink-0">
                    -
                    {formatMoney(
                      safeMoney(expense.amount),
                      currency,
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-6">
          <h3 className="font-bold mb-4">
            Bank transactions ({bankRows.length})
          </h3>

          {bankRows.length === 0 ? (
            <p className="text-sm text-slate-400">
              No transactions
            </p>
          ) : (
            <div className="divide-soft">
              {bankRows.map((transaction) => {
                const isDeposit =
                  transaction.type === "deposit";

                return (
                  <div
                    key={transaction.id}
                    className="py-2 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-sm capitalize">
                        {transaction.type}
                      </div>

                      <div className="text-xs text-slate-500 truncate">
                        {transaction.note || "-"}
                      </div>

                      <div className="text-xs text-slate-400 mt-0.5">
                        {formatDateTime(
                          transaction.createdAt,
                        )}
                      </div>
                    </div>

                    <div
                      className={`font-bold shrink-0 ${
                        isDeposit
                          ? "text-emerald-600"
                          : "text-amber-600"
                      }`}
                    >
                      {isDeposit ? "+" : "-"}
                      {formatMoney(
                        safeMoney(
                          transaction.amount,
                        ),
                        currency,
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  grad,
}: {
  label: string;
  value: string;
  grad: string;
}) {
  return (
    <div
      className={`kpi bg-gradient-to-br ${grad}`}
    >
      <div className="text-xs uppercase font-semibold text-white/80">
        {label}
      </div>

      <div className="text-2xl font-bold mt-2 tabular-nums">
        {value}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm py-1.5">
      <span className="text-slate-600">
        {label}
      </span>

      <span className="font-semibold tabular-nums text-right">
        {value}
      </span>
    </div>
  );
}