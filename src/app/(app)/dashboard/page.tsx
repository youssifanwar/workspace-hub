import { redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  bankTransactions,
  bookings,
  customers,
  expenses,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  calculateCustomerSessionSeatCharge,
  formatMoney,
  getCustomerSessionPricing,
  getSetting,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

type PaymentBreakdownRow = {
  method: string | null;
  total: string | null;
};

type ActiveSessionRow = {
  id: number;
  customerName: string;
  customerPhone: string | null;
  accessCode: string | null;
  checkedInAt: Date;
  hourlyRate: string | null;
  ordersTotal: string | null;
  discount: string | null;
  billingMode: string | null;
};

function safeNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : 0;

  return Number.isFinite(parsed) ? parsed : 0;
}

function getTodayStart() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return startOfDay;
}

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const [currency, sessionPricing] = await Promise.all([
    getSetting("currency"),
    getCustomerSessionPricing(),
  ]);

  const startOfDay = getTodayStart();

  const [
    todayRevenueRow,
    todayOrdersRow,
    todaySeatRow,
    todayExpensesRow,
    todayBankRow,
    directFnbRevenueRow,
    directFnbPaymentRows,
    customersCount,
    activeSessionsRows,
    recentSessions,
    paymentBreakdown,
  ] = await Promise.all([
    // TODAY'S REVENUE
    db
      .select({
        total: sql<string>`
          coalesce(sum(${bookings.total}), 0)
        `,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "closed"),
          gte(bookings.checkedOutAt, startOfDay),
        ),
      ),

    // TODAY'S F&B
    db
      .select({
        total: sql<string>`
          coalesce(sum(${bookings.ordersTotal}), 0)
        `,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "closed"),
          gte(bookings.checkedOutAt, startOfDay),
        ),
      ),

    // TODAY'S SEAT CHARGES
    db
      .select({
        total: sql<string>`
          coalesce(sum(${bookings.seatCharge}), 0)
        `,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "closed"),
          gte(bookings.checkedOutAt, startOfDay),
        ),
      ),

    // TODAY'S EXPENSES
    db
      .select({
        total: sql<string>`
          coalesce(sum(${expenses.amount}), 0)
        `,
      })
      .from(expenses)
      .where(gte(expenses.createdAt, startOfDay)),

    // TODAY'S BANK MOVEMENT
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
      .where(gte(bankTransactions.createdAt, startOfDay)),

    // DIRECT F&B SALES (walk-in / POS, not attached to a booking)
    db.execute(sql`
      select coalesce(sum(total), 0) as total
      from fnb_sales
      where created_at >= ${startOfDay}
    `),

    db.execute(sql`
      select payment_method as method, coalesce(sum(total), 0) as total
      from fnb_sales
      where created_at >= ${startOfDay}
      group by payment_method
    `),

    // TOTAL CUSTOMERS
    db
      .select({
        c: sql<number>`count(*)::int`,
      })
      .from(customers),

    // ACTIVE SESSIONS
    db
      .select({
        id: bookings.id,
        customerName: customers.name,
        customerPhone: customers.phone,
        accessCode: bookings.accessCode,
        checkedInAt: bookings.checkedInAt,
        hourlyRate: bookings.hourlyRateSnapshot,
        ordersTotal: bookings.ordersTotal,
        discount: bookings.discount,
        billingMode: bookings.billingMode,
      })
      .from(bookings)
      .innerJoin(
        customers,
        eq(customers.id, bookings.customerId),
      )
      .where(eq(bookings.status, "active"))
      .orderBy(bookings.checkedInAt),

    // RECENT CLOSED SESSIONS
    db
      .select({
        id: bookings.id,
        customerName: customers.name,
        total: bookings.total,
        paymentMethod: bookings.paymentMethod,
        checkedOutAt: bookings.checkedOutAt,
      })
      .from(bookings)
      .innerJoin(
        customers,
        eq(customers.id, bookings.customerId),
      )
      .where(eq(bookings.status, "closed"))
      .orderBy(desc(bookings.checkedOutAt))
      .limit(6),

    // PAYMENTS TODAY
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
          eq(bookings.status, "closed"),
          gte(bookings.checkedOutAt, startOfDay),
        ),
      )
      .groupBy(bookings.paymentMethod),
  ]);

  const directFnbRevenue = safeNumber(
    (directFnbRevenueRow.rows?.[0] as { total?: unknown } | undefined)?.total,
  );

  const todayRevenue =
    safeNumber(todayRevenueRow[0]?.total) + directFnbRevenue;
  const todayOrders =
    safeNumber(todayOrdersRow[0]?.total) + directFnbRevenue;
  const todaySeat = safeNumber(todaySeatRow[0]?.total);
  const todayExpenses = safeNumber(todayExpensesRow[0]?.total);

  const bankDeposits = safeNumber(todayBankRow[0]?.deposits);
  const bankWithdrawals = safeNumber(todayBankRow[0]?.withdrawals);

  const directFnbPayments = new Map<string, number>();
  for (const row of directFnbPaymentRows.rows ?? []) {
    const method = String((row as { method?: unknown }).method ?? "unknown");
    const total = safeNumber((row as { total?: unknown }).total);
    directFnbPayments.set(method, (directFnbPayments.get(method) ?? 0) + total);
  }

  const mergedPayments = new Map<string, number>();
  for (const row of paymentBreakdown) {
    const method = String(row.method ?? "unknown");
    mergedPayments.set(method, (mergedPayments.get(method) ?? 0) + safeNumber(row.total));
  }
  for (const [method, total] of directFnbPayments) {
    mergedPayments.set(method, (mergedPayments.get(method) ?? 0) + total);
  }

  const paymentBreakdownCombined: PaymentBreakdownRow[] = Array.from(
    mergedPayments.entries(),
  ).map(([method, total]) => ({
    method: method === "unknown" ? null : method,
    total: total.toFixed(2),
  }));

  const netRevenue = todayRevenue - todayExpenses;
  const activeCount = activeSessionsRows.length;
  const totalCustomers = Number(customersCount[0]?.c ?? 0);

  const kpis = [
    {
      label: "Today's Revenue",
      value: formatMoney(todayRevenue, currency),
      icon: "💰",
      grad: "from-emerald-500 to-teal-500",
    },
    {
      label: "Seat Charges",
      value: formatMoney(todaySeat, currency),
      icon: "⏱️",
      grad: "from-indigo-500 to-purple-500",
    },
    {
      label: "F&B Sales",
      value: formatMoney(todayOrders, currency),
      icon: "🍔",
      grad: "from-orange-500 to-pink-500",
    },
    {
      label: "Expenses",
      value: formatMoney(todayExpenses, currency),
      icon: "💸",
      grad: "from-rose-500 to-red-500",
    },
    {
      label: "Net Profit",
      value: formatMoney(netRevenue, currency),
      icon: "📈",
      grad: "from-cyan-500 to-blue-500",
    },
    {
      label: "Active Sessions",
      value: `${activeCount}`,
      icon: "👤",
      grad: "from-fuchsia-500 to-pink-500",
    },
    {
      label: "Customers",
      value: `${totalCustomers}`,
      icon: "👥",
      grad: "from-slate-700 to-slate-500",
    },
    {
      label: "Bank Δ Today",
      value: formatMoney(
        bankDeposits - bankWithdrawals,
        currency,
      ),
      sub: `+${formatMoney(
        bankDeposits,
        currency,
      )} / -${formatMoney(
        bankWithdrawals,
        currency,
      )}`,
      icon: "🏦",
      grad: "from-amber-500 to-orange-500",
    },
  ];

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Dashboard
          </h1>

          <p className="text-slate-500">
            Welcome back,{" "}
            {user.fullName.trim().split(/\s+/)[0] || user.fullName} 👋
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href="/bookings"
            className="btn btn-primary"
          >
            + New Session
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className={`kpi bg-gradient-to-br ${kpi.grad}`}
          >
            <div className="flex items-start justify-between relative z-10">
              <div>
                <div className="text-xs uppercase tracking-wider text-white/80 font-semibold">
                  {kpi.label}
                </div>

                <div className="text-2xl font-bold mt-2 tabular-nums">
                  {kpi.value}
                </div>

                {kpi.sub && (
                  <div className="text-[11px] mt-1 text-white/85">
                    {kpi.sub}
                  </div>
                )}
              </div>

              <div className="text-3xl relative z-10">
                {kpi.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ACTIVE SESSIONS + PAYMENTS */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* ACTIVE SESSIONS */}
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">
              Active Sessions
            </h2>

            <Link
              href="/bookings"
              className="text-sm text-indigo-600 font-semibold"
            >
              View all →
            </Link>
          </div>

          {activeSessionsRows.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <div className="text-4xl mb-2">
                👤
              </div>

              No active sessions right now
            </div>
          ) : (
            <div className="divide-soft">
              {(activeSessionsRows as ActiveSessionRow[]).map(
                (session) => {
                  const startedAt = new Date(
                    session.checkedInAt,
                  ).getTime();

                  const elapsedMs = Math.max(
                    0,
                    Date.now() - startedAt,
                  );

                  const elapsedHours =
                    elapsedMs / 3_600_000;

                  const isPackage =
                    session.billingMode === "package";

                  /*
                   * Customer Session billing:
                   * - Package => seat charge = 0
                   * - Regular => 1h 40, 2h 70, 3h 100,
                   *   4h 130, >4h Day Pass 150
                   *
                   * This keeps the dashboard aligned with
                   * the server-side customer session pricing.
                   */
                  const seatCharge = isPackage
                    ? 0
                    : calculateCustomerSessionSeatCharge(
                        Math.max(1, Math.ceil(elapsedHours)),
                        sessionPricing,
                      );

                  const ordersTotal = safeNumber(
                    session.ordersTotal,
                  );

                  const discount = safeNumber(
                    session.discount,
                  );

                  const currentTotal = Math.max(
                    0,
                    seatCharge +
                      ordersTotal -
                      discount,
                  );

                  return (
                    <Link
                      key={session.id}
                      href={`/bookings/${session.id}`}
                      className="flex items-center gap-3 py-3 hover:bg-slate-50 rounded-lg px-2 -mx-2"
                    >
                      <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 grid place-items-center font-bold">
                        {session.customerName
                          .charAt(0)
                          .toUpperCase()}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-800 truncate">
                          {session.customerName}
                        </div>

                        <div className="text-xs text-slate-500">
                          Session #{session.id}
                          {" · "}
                          started{" "}
                          {new Date(
                            session.checkedInAt,
                          ).toLocaleTimeString()}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="badge badge-green">
                          Active
                        </div>

                        <div className="text-xs font-bold text-indigo-600 mt-1">
                          {formatMoney(
                            currentTotal,
                            currency,
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                },
              )}
            </div>
          )}
        </div>

        {/* PAYMENTS */}
        <div className="card p-6">
          <h2 className="text-lg font-bold mb-4">
            Payments Today
          </h2>

          {paymentBreakdownCombined.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              No payments yet
            </div>
          ) : (
            <div className="space-y-3">
              {paymentBreakdownCombined.map(
                (payment) => {
                  const label =
                    payment.method === "cash"
                      ? "💵 Cash"
                      : payment.method === "visa"
                        ? "💳 Visa"
                        : payment.method === "instapay"
                          ? "📱 InstaPay"
                          : payment.method === "bank"
                            ? "🏦 Bank"
                            : payment.method === "card"
                              ? "💳 Card"
                              : payment.method
                                ? payment.method
                                : "Unknown";

                  return (
                    <div
                      key={payment.method ?? "unknown"}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-50"
                    >
                      <div className="text-sm font-semibold">
                        {label}
                      </div>

                      <div className="font-bold text-slate-800 tabular-nums">
                        {formatMoney(
                          safeNumber(payment.total),
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
      </div>

      {/* RECENT CLOSED SESSIONS */}
      <div className="card p-6">
        <h2 className="text-lg font-bold mb-4">
          Recent Closed Sessions
        </h2>

        {recentSessions.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            No closed sessions yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase">
                  <th className="py-2 px-2">
                    Customer
                  </th>

                  <th className="py-2 px-2">
                    Session
                  </th>

                  <th className="py-2 px-2">
                    Payment
                  </th>

                  <th className="py-2 px-2">
                    Closed
                  </th>

                  <th className="py-2 px-2 text-right">
                    Total
                  </th>
                </tr>
              </thead>

              <tbody>
                {recentSessions.map((session) => (
                  <tr
                    key={session.id}
                    className="border-t border-slate-100"
                  >
                    <td className="py-3 px-2 font-semibold">
                      {session.customerName}
                    </td>

                    <td className="py-3 px-2">
                      #{session.id}
                    </td>

                    <td className="py-3 px-2 capitalize">
                      {session.paymentMethod || "-"}
                    </td>

                    <td className="py-3 px-2 text-slate-500">
                      {session.checkedOutAt
                        ? new Date(
                            session.checkedOutAt,
                          ).toLocaleString()
                        : "-"}
                    </td>

                    <td className="py-3 px-2 text-right font-bold tabular-nums">
                      {formatMoney(
                        safeNumber(session.total),
                        currency,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}