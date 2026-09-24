import Link from "next/link";
import { redirect } from "next/navigation";
import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
  lte,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  bankTransactions,
  bookingItems,
  bookings,
  expenses,
  shifts,
  users,
} from "@/db/schema";

import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";

import {
  formatMoney,
  getSetting,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

type SearchParams = {
  range?: string;
};

function safeNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : 0;

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function parseReportDays(value: string | undefined) {
  const parsed = Number.parseInt(
    value ?? "7",
    10,
  );

  if (!Number.isFinite(parsed)) {
    return 7;
  }

  if (parsed <= 1) {
    return 1;
  }

  if (parsed <= 7) {
    return 7;
  }

  if (parsed <= 30) {
    return 30;
  }

  return 90;
}

function formatDate(
  value: Date,
) {
  if (
    !(value instanceof Date) ||
    Number.isNaN(value.getTime())
  ) {
    return "-";
  }

  return value.toLocaleDateString(
    "en-EG",
  );
}

function formatDateTime(
  value: Date | null,
) {
  if (
    !value ||
    !(value instanceof Date) ||
    Number.isNaN(value.getTime())
  ) {
    return "-";
  }

  return value.toLocaleString(
    "en-EG",
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (!canManage(user.role)) {
    redirect("/dashboard");
  }

  const currency =
    await getSetting("currency");

  const params = await searchParams;

  const days = parseReportDays(
    params.range,
  );

  const from = new Date();
  from.setHours(
    0,
    0,
    0,
    0,
  );

  from.setDate(
    from.getDate() - days + 1,
  );

  const to = new Date();
  to.setHours(
    23,
    59,
    59,
    999,
  );

  const [
    revenueRow,
    dailyRows,
    topProducts,
    directFnbRevenueRow,
    directFnbDailyRows,
    directFnbTopProductsRows,
    directFnbPaymentRows,
    expensesRow,
    bankRow,
    paymentRows,
    shiftRows,
  ] = await Promise.all([
    // -------------------------------------------------------------------------
    // REVENUE
    //
    // Closed sessions are reported by checkout time because that is the point
    // where the final amount is actually realized.
    // -------------------------------------------------------------------------
    db
      .select({
        revenue: sql<string>`
          coalesce(
            sum(${bookings.total}),
            0
          )
        `,
        seat: sql<string>`
          coalesce(
            sum(${bookings.seatCharge}),
            0
          )
        `,
        orders: sql<string>`
          coalesce(
            sum(${bookings.ordersTotal}),
            0
          )
        `,
        count: sql<number>`
          count(*)::int
        `,
      })
      .from(bookings)
      .where(
        and(
          eq(
            bookings.status,
            "closed",
          ),
          gte(
            bookings.checkedOutAt,
            from,
          ),
          lte(
            bookings.checkedOutAt,
            to,
          ),
        ),
      ),

    // -------------------------------------------------------------------------
    // DAILY REVENUE
    // -------------------------------------------------------------------------
    db
      .select({
        day: sql<string>`
          to_char(
            date_trunc(
              'day',
              ${bookings.checkedOutAt}
            ),
            'YYYY-MM-DD'
          )
        `,
        revenue: sql<string>`
          coalesce(
            sum(${bookings.total}),
            0
          )
        `,
      })
      .from(bookings)
      .where(
        and(
          eq(
            bookings.status,
            "closed",
          ),
          gte(
            bookings.checkedOutAt,
            from,
          ),
          lte(
            bookings.checkedOutAt,
            to,
          ),
        ),
      )
      .groupBy(
        sql`
          date_trunc(
            'day',
            ${bookings.checkedOutAt}
          )
        `,
      )
      .orderBy(
        sql`
          date_trunc(
            'day',
            ${bookings.checkedOutAt}
          )
        `,
      ),

    // -------------------------------------------------------------------------
    // TOP PRODUCTS
    // -------------------------------------------------------------------------
    db
      .select({
        name: bookingItems.nameSnapshot,
        qty: sql<number>`
          sum(
            ${bookingItems.quantity}
          )::int
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
        eq(
          bookings.id,
          bookingItems.bookingId,
        ),
      )
      .where(
        and(
          eq(
            bookings.status,
            "closed",
          ),
          gte(
            bookings.checkedOutAt,
            from,
          ),
          lte(
            bookings.checkedOutAt,
            to,
          ),
        ),
      )
      .groupBy(
        bookingItems.nameSnapshot,
      )
      .orderBy(
        desc(
          sql`
            sum(
              ${bookingItems.quantity}
            )
          `,
        ),
      )
      .limit(10),

    // -------------------------------------------------------------------------
    // DIRECT F&B SALES (walk-in / POS, not attached to a booking)
    // -------------------------------------------------------------------------
    db.execute(sql`
      SELECT COALESCE(SUM(total), 0) AS total
      FROM fnb_sales
      WHERE created_at >= ${from}
        AND created_at <= ${to}
    `),

    db.execute(sql`
      SELECT
        to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
        COALESCE(SUM(total), 0) AS revenue
      FROM fnb_sales
      WHERE created_at >= ${from}
        AND created_at <= ${to}
      GROUP BY date_trunc('day', created_at)
      ORDER BY date_trunc('day', created_at)
    `),

        db.execute(sql`
      SELECT
        name_snapshot AS name,
        SUM(quantity)::int AS qty,
        COALESCE(SUM(quantity * unit_price), 0) AS revenue
      FROM fnb_sale_items
      INNER JOIN fnb_sales
        ON fnb_sales.id = fnb_sale_items.sale_id
      WHERE fnb_sales.created_at >= ${from}
        AND fnb_sales.created_at <= ${to}
      GROUP BY name_snapshot
      ORDER BY SUM(quantity) DESC, COALESCE(SUM(quantity * unit_price), 0) DESC
      LIMIT 20
    `),
    db.execute(sql`
      SELECT
        payment_method,
        COALESCE(SUM(total), 0) AS total
      FROM fnb_sales
      WHERE created_at >= ${from}
        AND created_at <= ${to}
      GROUP BY payment_method
    `),

    // -------------------------------------------------------------------------
    // EXPENSES
    // -------------------------------------------------------------------------
    db
      .select({
        total: sql<string>`
          coalesce(
            sum(${expenses.amount}),
            0
          )
        `,
      })
      .from(expenses)
      .where(
        and(
          gte(
            expenses.createdAt,
            from,
          ),
          lte(
            expenses.createdAt,
            to,
          ),
        ),
      ),

    // -------------------------------------------------------------------------
    // BANK
    // -------------------------------------------------------------------------
    db
      .select({
        deposits: sql<string>`
          coalesce(
            sum(
              case
                when ${bankTransactions.type} = 'deposit'
                then ${bankTransactions.amount}
                else 0
              end
            ),
            0
          )
        `,
        withdrawals: sql<string>`
          coalesce(
            sum(
              case
                when ${bankTransactions.type} = 'withdraw'
                then ${bankTransactions.amount}
                else 0
              end
            ),
            0
          )
        `,
      })
      .from(bankTransactions)
      .where(
        and(
          gte(
            bankTransactions.createdAt,
            from,
          ),
          lte(
            bankTransactions.createdAt,
            to,
          ),
        ),
      ),

    // -------------------------------------------------------------------------
    // PAYMENT METHODS
    // -------------------------------------------------------------------------
    db
      .select({
        method:
          bookings.paymentMethod,
        total: sql<string>`
          coalesce(
            sum(${bookings.total}),
            0
          )
        `,
      })
      .from(bookings)
      .where(
        and(
          eq(
            bookings.status,
            "closed",
          ),
          gte(
            bookings.checkedOutAt,
            from,
          ),
          lte(
            bookings.checkedOutAt,
            to,
          ),
        ),
      )
      .groupBy(
        bookings.paymentMethod,
      ),

    // -------------------------------------------------------------------------
    // RECENT CLOSED SHIFTS
    // -------------------------------------------------------------------------
    db
      .select({
        id: shifts.id,
        userName: users.fullName,
        openedAt: shifts.openedAt,
        closedAt: shifts.closedAt,
        openingCash:
          shifts.openingCash,
        closingCash:
          shifts.closingCash,
      })
      .from(shifts)
      .innerJoin(
        users,
        eq(
          users.id,
          shifts.userId,
        ),
      )
      .where(
        and(
          isNotNull(
            shifts.closedAt,
          ),
          gte(
            shifts.openedAt,
            from,
          ),
          lte(
            shifts.openedAt,
            to,
          ),
        ),
      )
      .orderBy(
        desc(
          shifts.openedAt,
        ),
      )
      .limit(20),
  ]);

  const directFnbRevenue = safeNumber(
    (directFnbRevenueRow as { rows?: Array<Record<string, unknown>> }).rows?.[0]?.total,
  );

  const bookingRevenue = safeNumber(
    revenueRow[0]?.revenue,
  );

  const revenue = bookingRevenue + directFnbRevenue;

  const totalExpenses =
    safeNumber(
      expensesRow[0]?.total,
    );

  const seatTotal =
    safeNumber(
      revenueRow[0]?.seat,
    );

  const ordersTotal =
    safeNumber(
      revenueRow[0]?.orders,
    ) + directFnbRevenue;

  const bookingCount =
    Number(
      revenueRow[0]?.count ?? 0,
    ) || 0;

  const bankDeposits =
    safeNumber(
      bankRow[0]?.deposits,
    );

  const bankWithdrawals =
    safeNumber(
      bankRow[0]?.withdrawals,
    );

  const directFnbDailyMap = new Map(
    ((directFnbDailyRows as { rows?: Array<Record<string, unknown>> }).rows ?? []).map((row) => [
      String(row.day ?? ''),
      safeNumber(row.revenue),
    ]),
  );

  const dailyRowsMerged = dailyRows.map((row) => ({
    day: row.day,
    revenue: safeNumber(row.revenue) + (directFnbDailyMap.get(row.day) ?? 0),
  }));

  const seenDays = new Set(dailyRowsMerged.map((row) => row.day));
  for (const [day, value] of directFnbDailyMap) {
    if (!seenDays.has(day)) {
      dailyRowsMerged.push({ day, revenue: value });
    }
  }
  dailyRowsMerged.sort((a, b) => a.day.localeCompare(b.day));

  const dailyValues =
    dailyRowsMerged.map((row) => row.revenue);

  const maxDaily = Math.max(
    1,
    ...dailyValues,
  );

  const directTopProducts =
    ((directFnbTopProductsRows as { rows?: Array<Record<string, unknown>> }).rows ?? []).map((row) => ({
      name: String(row.name ?? ''),
      qty: safeNumber(row.qty),
      revenue: safeNumber(row.revenue),
    }));

  const mergedTopProducts = Array.from(
    [...topProducts.map((row) => ({
      name: row.name,
      qty: safeNumber(row.qty),
      revenue: safeNumber(row.revenue),
    })), ...directTopProducts]
      .reduce((map, item) => {
        const existing = map.get(item.name) ?? { name: item.name, qty: 0, revenue: 0 };
        existing.qty += item.qty;
        existing.revenue += item.revenue;
        map.set(item.name, existing);
        return map;
      }, new Map<string, { name: string; qty: number; revenue: number }>())
      .values(),
  ).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 10);

  const directPaymentMap = new Map(
    ((directFnbPaymentRows as { rows?: Array<Record<string, unknown>> }).rows ?? []).map((row) => [
      String(row.payment_method ?? ''),
      safeNumber(row.total),
    ]),
  );

  const combinedPaymentMap = new Map<string, number>();
  for (const row of paymentRows) {
    const key = String(row.method ?? 'unknown');
    combinedPaymentMap.set(key, safeNumber(row.total));
  }
  for (const [method, value] of directPaymentMap) {
    combinedPaymentMap.set(method, (combinedPaymentMap.get(method) ?? 0) + value);
  }
  const combinedPaymentRows = Array.from(combinedPaymentMap, ([method, total]) => ({ method, total }));

  const averageBooking =
    bookingCount > 0
      ? bookingRevenue / bookingCount
      : 0;

  const netProfit =
    revenue - totalExpenses;

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Reports
          </h1>

          <p className="text-slate-500">
            {formatDate(from)} →{" "}
            {formatDate(to)} · Last {days} days
          </p>
        </div>

        <div className="flex gap-1">
          {[1, 7, 30, 90].map(
            (range) => (
              <Link
                key={range}
                href={`/reports?range=${range}`}
                aria-current={
                  days === range
                    ? "page"
                    : undefined
                }
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                  days === range
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-slate-200 hover:border-slate-300"
                }`}
              >
                {range === 1
                  ? "Today"
                  : `${range}d`}
              </Link>
            ),
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="kpi bg-gradient-to-br from-emerald-500 to-teal-500">
          <div className="text-xs uppercase text-white/80 font-semibold">
            Revenue
          </div>

          <div className="text-2xl font-bold mt-2 tabular-nums">
            {formatMoney(
              revenue,
              currency,
            )}
          </div>
        </div>

        <div className="kpi bg-gradient-to-br from-indigo-500 to-purple-500">
          <div className="text-xs uppercase text-white/80 font-semibold">
            Seat charges
          </div>

          <div className="text-2xl font-bold mt-2 tabular-nums">
            {formatMoney(
              seatTotal,
              currency,
            )}
          </div>
        </div>

        <div className="kpi bg-gradient-to-br from-orange-500 to-pink-500">
          <div className="text-xs uppercase text-white/80 font-semibold">
            F&B
          </div>

          <div className="text-2xl font-bold mt-2 tabular-nums">
            {formatMoney(
              ordersTotal,
              currency,
            )}
          </div>
        </div>

        <div className="kpi bg-gradient-to-br from-rose-500 to-red-500">
          <div className="text-xs uppercase text-white/80 font-semibold">
            Expenses
          </div>

          <div className="text-2xl font-bold mt-2 tabular-nums">
            {formatMoney(
              totalExpenses,
              currency,
            )}
          </div>
        </div>
      </div>

      {/* DAILY REVENUE + PAYMENTS */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* DAILY REVENUE */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="font-bold mb-4">
            Daily revenue
          </h3>

          {dailyRowsMerged.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              No data
            </div>
          ) : (
            <div
              className="flex items-end gap-2 h-48"
              aria-label="Daily revenue chart"
            >
              {dailyRowsMerged.map(
                (row) => {
                  const value =
                    safeNumber(
                      row.revenue,
                    );

                  const height =
                    Math.min(
                      100,
                      Math.max(
                        0,
                        (value / maxDaily) *
                          100,
                      ),
                    );

                  return (
                    <div
                      key={row.day}
                      className="flex-1 flex flex-col items-center gap-1 min-w-0"
                    >
                      <div className="text-[10px] text-slate-500 font-semibold tabular-nums">
                        {value.toFixed(0)}
                      </div>

                      <div
                        className="w-full rounded-t-lg bg-gradient-to-t from-indigo-600 to-cyan-400 min-h-[4px]"
                        style={{
                          height: `${height}%`,
                        }}
                        title={`${row.day}: ${value.toFixed(
                          2,
                        )} ${currency}`}
                        role="img"
                        aria-label={`${row.day}: ${value.toFixed(
                          2,
                        )} ${currency}`}
                      />

                      <div className="text-[10px] text-slate-500 truncate w-full text-center">
                        {row.day.slice(5)}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}

          <div className="mt-4 text-sm text-slate-500">
            {bookingCount} bookings · Avg{" "}
            {formatMoney(
              averageBooking,
              currency,
            )}{" "}
            per booking
          </div>
        </div>

        {/* PAYMENTS */}
        <div className="card p-6">
          <h3 className="font-bold mb-4">
            Payment methods
          </h3>

          {combinedPaymentRows.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-6">
              No sales
            </div>
          ) : (
            <div className="space-y-2">
              {combinedPaymentRows.map(
                (payment) => {
                  const value =
                    safeNumber(
                      payment.total,
                    );

                  const percentage =
                    revenue > 0
                      ? Math.min(
                          100,
                          Math.max(
                            0,
                            (value /
                              revenue) *
                              100,
                          ),
                        )
                      : 0;

                  const label =
                    payment.method ===
                    "cash"
                      ? "💵 Cash"
                      : payment.method ===
                          "visa"
                        ? "💳 Visa"
                        : payment.method ===
                            "instapay"
                          ? "📱 InstaPay"
                          : payment.method ===
                              "bank"
                            ? "🏦 Bank"
                            : payment.method ===
                                "card"
                              ? "💳 Card"
                              : payment.method
                                ? payment.method
                                : "Unknown";

                  return (
                    <div
                      key={
                        payment.method ??
                        "unknown"
                      }
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span>
                          {label}
                        </span>

                        <span className="font-bold tabular-nums">
                          {formatMoney(
                            value,
                            currency,
                          )}
                        </span>
                      </div>

                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-cyan-500"
                          style={{
                            width: `${percentage}%`,
                          }}
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-slate-100 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-600">
                Bank deposits
              </span>

              <span className="font-semibold tabular-nums">
                {formatMoney(
                  bankDeposits,
                  currency,
                )}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-600">
                Bank withdrawals
              </span>

              <span className="font-semibold tabular-nums">
                {formatMoney(
                  bankWithdrawals,
                  currency,
                )}
              </span>
            </div>

            <div className="flex justify-between text-base font-bold pt-2 border-t border-slate-100">
              <span>
                Net profit
              </span>

              <span
                className={
                  netProfit >= 0
                    ? "text-emerald-600"
                    : "text-rose-600"
                }
              >
                {formatMoney(
                  netProfit,
                  currency,
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* PRODUCTS + SHIFTS */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* TOP PRODUCTS */}
        <div className="card p-6">
          <h3 className="font-bold mb-4">
            Top selling products
          </h3>

          {mergedTopProducts.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">
              No sales yet
            </p>
          ) : (
            <div className="space-y-2">
              {mergedTopProducts.map(
                (product, index) => {
                  const revenueValue =
                    safeNumber(
                      product.revenue,
                    );

                  const quantity =
                    Number(
                      product.qty,
                    ) || 0;

                  return (
                    <div
                      key={`${product.name}-${index}`}
                      className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50"
                    >
                      <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 grid place-items-center font-bold text-sm">
                        {index + 1}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">
                          {product.name}
                        </div>

                        <div className="text-xs text-slate-500">
                          {quantity} units
                        </div>
                      </div>

                      <div className="font-bold tabular-nums">
                        {formatMoney(
                          revenueValue,
                          currency,
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>

        {/* RECENT SHIFTS */}
        <div className="card p-6">
          <h3 className="font-bold mb-4">
            Recent shifts
          </h3>

          {shiftRows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">
              No shifts
            </p>
          ) : (
            <div className="divide-soft">
              {shiftRows.map(
                (shift) => (
                  <Link
                    key={shift.id}
                    href={`/shift/summary/${shift.id}`}
                    className="py-2 flex items-center justify-between hover:bg-slate-50 rounded-lg px-2"
                  >
                    <div>
                      <div className="font-semibold text-sm">
                        Shift #{shift.id} ·{" "}
                        {shift.userName}
                      </div>

                      <div className="text-xs text-slate-500">
                        {formatDateTime(
                          shift.openedAt,
                        )}
                      </div>
                    </div>

                    <span className="text-sm text-indigo-600 font-semibold">
                      View →
                    </span>
                  </Link>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}