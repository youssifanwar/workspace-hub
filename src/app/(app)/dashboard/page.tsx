import { redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  bankTransactions,
  bookings,
  customerMeetingRoomPackages,
  customers,
  customerSubscriptions,
  expenses,
  manualIncomes,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  calculateCustomerSessionSeatCharge,
  formatMoney,
  getCustomerSessionPricing,
  getSetting,
} from "@/lib/settings";
import { activeTimeZone, getZonedDayRange, loadTimezone } from "@/lib/timezone";

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

export default async function DashboardPage() {
  const user = await getCurrentUser();
  await loadTimezone();

  if (!user) {
    redirect("/login");
  }

  const [currency, sessionPricing] = await Promise.all([
    getSetting("currency"),
    getCustomerSessionPricing(),
  ]);

  const { todayStart: startOfDay, to: endOfDay } = getZonedDayRange(1, activeTimeZone());

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
    todayDeskPackageRow,
    todayMeetingPackageRow,
    todayManualIncomeRow,
    activeMeetingRoomsRow,
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
          lte(bookings.checkedOutAt, endOfDay),
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
          lte(bookings.checkedOutAt, endOfDay),
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
          lte(bookings.checkedOutAt, endOfDay),
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
      // A voided package is already removed from revenue, so its cash
      // refund must not be subtracted from profit a second time.
      .where(
        and(
          gte(expenses.createdAt, startOfDay),
          lte(expenses.createdAt, endOfDay),
          sql`${expenses.category} <> 'Package refund'`,
        ),
      ),

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
      .where(and(gte(bankTransactions.createdAt, startOfDay), lte(bankTransactions.createdAt, endOfDay))),

    // DIRECT F&B SALES (walk-in / POS, not attached to a booking)
    db.execute(sql`
      select coalesce(sum(total), 0) as total
      from fnb_sales
      where created_at >= ${startOfDay} and created_at <= ${endOfDay}
    `),

    db.execute(sql`
      select payment_method as method, coalesce(sum(total), 0) as total
      from fnb_sales
      where created_at >= ${startOfDay} and created_at <= ${endOfDay}
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
      // Meeting-room check-ins also create a row in `bookings` (deskId set
      // to the room) so F&B orders can attach to them. Exclude those here:
      // this widget is for open-seating ("shared") customer sessions only,
      // which always have deskId = null.
      .where(and(eq(bookings.status, "active"), isNull(bookings.deskId)))
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
          lte(bookings.checkedOutAt, endOfDay),
        ),
      )
      .groupBy(bookings.paymentMethod),

    // TODAY'S PACKAGE SALES (desk), by payment date, excluding cancelled
    db
      .select({
        total: sql<string>`coalesce(sum(${customerSubscriptions.priceSnapshot}), 0)`,
      })
      .from(customerSubscriptions)
      .where(
        and(
          sql`${customerSubscriptions.status} <> 'cancelled'`,
          gte(customerSubscriptions.purchasedAt, startOfDay),
          lte(customerSubscriptions.purchasedAt, endOfDay),
        ),
      ),

    // TODAY'S PACKAGE SALES (meeting room), by payment date
    db
      .select({
        total: sql<string>`coalesce(sum(${customerMeetingRoomPackages.priceSnapshot}), 0)`,
      })
      .from(customerMeetingRoomPackages)
      .where(
        and(
          sql`${customerMeetingRoomPackages.status} <> 'cancelled'`,
          gte(customerMeetingRoomPackages.purchasedAt, startOfDay),
          lte(customerMeetingRoomPackages.purchasedAt, endOfDay),
        ),
      ),

    // TODAY'S MANUAL INCOME (Expenses & Income page)
    db
      .select({
        total: sql<string>`coalesce(sum(${manualIncomes.amount}), 0)`,
      })
      .from(manualIncomes)
      .where(and(gte(manualIncomes.createdAt, startOfDay), lte(manualIncomes.createdAt, endOfDay))),

    // ACTIVE MEETING ROOM SESSIONS (separate from open-seating sessions)
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "active"),
          sql`${bookings.deskId} is not null`,
        ),
      ),
  ]);

  const otherPaymentRows = await db.execute(sql`
    SELECT method, COALESCE(SUM(amount), 0) AS total
    FROM (
      SELECT payment_method AS method, price_snapshot AS amount
      FROM customer_subscriptions
      WHERE status <> 'cancelled' AND purchased_at >= ${startOfDay} AND purchased_at <= ${endOfDay}
      UNION ALL
      SELECT payment_method AS method, price_snapshot AS amount
      FROM customer_meeting_room_packages
      WHERE status <> 'cancelled' AND purchased_at >= ${startOfDay} AND purchased_at <= ${endOfDay}
      UNION ALL
      SELECT payment_method AS method, amount
      FROM manual_incomes
      WHERE created_at >= ${startOfDay} AND created_at <= ${endOfDay}
    ) other_sources
    GROUP BY method
  `);

  const directFnbRevenue = safeNumber(
    (directFnbRevenueRow.rows?.[0] as { total?: unknown } | undefined)?.total,
  );

  const todayPackageSales =
    safeNumber(todayDeskPackageRow[0]?.total) +
    safeNumber(todayMeetingPackageRow[0]?.total);
  const todayManualIncome = safeNumber(todayManualIncomeRow[0]?.total);

  const todayRevenue =
    safeNumber(todayRevenueRow[0]?.total) +
    directFnbRevenue +
    todayPackageSales +
    todayManualIncome;
  const todayOrders =
    safeNumber(todayOrdersRow[0]?.total) + directFnbRevenue;
  const todaySeat = safeNumber(todaySeatRow[0]?.total);
  const todayExpenses = safeNumber(todayExpensesRow[0]?.total);
  const activeMeetingRoomsCount = Number(
    activeMeetingRoomsRow[0]?.c ?? 0,
  );

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
  for (const row of otherPaymentRows.rows ?? []) {
    const method = String((row as { method?: unknown }).method ?? "unknown");
    const total = safeNumber((row as { total?: unknown }).total);
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
      sub: `Direct F&B ${formatMoney(directFnbRevenue, currency)} · Packages ${formatMoney(todayPackageSales, currency)} · Other ${formatMoney(todayManualIncome, currency)}`,
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
      sub: `Direct POS ${formatMoney(directFnbRevenue, currency)} included`,
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
      label: "Active Meeting Rooms",
      value: `${activeMeetingRoomsCount}`,
      icon: "🗓️",
      grad: "from-violet-500 to-indigo-500",
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

  const paymentTotal = paymentBreakdownCombined.reduce(
    (sum, payment) => sum + safeNumber(payment.total),
    0,
  );
  const firstName = user.fullName.trim().split(/\s+/)[0] || user.fullName;
  const todayLabel = new Date().toLocaleDateString("en-EG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: activeTimeZone(),
  });

  return (
    <div className="dashboard-page space-y-6">
      {/* HERO */}
      <section className="dashboard-hero">
        <div className="dashboard-hero-orb dashboard-hero-orb-one" aria-hidden="true" />
        <div className="dashboard-hero-orb dashboard-hero-orb-two" aria-hidden="true" />
        <div className="dashboard-hero-grid" aria-hidden="true" />
        <div className="dashboard-hero-content">
          <div className="dashboard-overline"><span className="dashboard-overline-dot" /> WORKSPACE OVERVIEW <span className="dashboard-overline-line" /></div>
          <h1>Good day, {firstName}<span className="dashboard-hero-wave">✦</span></h1>
          <p>Your workspace at a glance. Here&apos;s what&apos;s happening today.</p>
          <div className="dashboard-hero-meta">
            <span className="dashboard-date-chip"><svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden="true"><rect x="2.5" y="4" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M6 2.5v3M14 2.5v3M3 8h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>{todayLabel}</span>
            <span className="dashboard-meta-divider" />
            <span>{activeCount} active {activeCount === 1 ? "session" : "sessions"}</span>
            <span className="dashboard-meta-divider" />
            <span>{activeMeetingRoomsCount} meeting {activeMeetingRoomsCount === 1 ? "room" : "rooms"} in use</span>
          </div>
        </div>
        <div className="dashboard-hero-actions">
          <Link href="/bookings" className="dashboard-primary-action">
            <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            New session
          </Link>
          <Link href="/meeting-rooms/calendar" className="dashboard-secondary-action">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true"><rect x="2.5" y="4" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M6 2.5v3M14 2.5v3M3 8h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            Room calendar
          </Link>
        </div>
      </section>

      {/* KPI SNAPSHOT */}
      <section aria-label="Today's business metrics">
        <div className="dashboard-section-heading">
          <div>
            <div className="dashboard-section-eyebrow">THE NUMBERS</div>
            <h2>Today&apos;s performance</h2>
          </div>
          <span className="dashboard-updated-tag"><span /> Updated for today</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-5 gap-4 dashboard-kpi-grid">
          {kpis.map((kpi) => (
            <div key={kpi.label} className={`kpi bg-gradient-to-br ${kpi.grad}`}>
              <div className="flex items-start justify-between relative z-10 gap-2">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wider text-white/80 font-semibold">{kpi.label}</div>
                  <div className="text-2xl font-bold mt-3 tabular-nums break-words">{kpi.value}</div>
                  {kpi.sub && <div className="text-[11px] mt-2 text-white/85 leading-relaxed">{kpi.sub}</div>}
                </div>
                <div className="text-3xl relative z-10 shrink-0" aria-hidden="true">{kpi.icon}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ACTIVE SESSIONS + PAYMENT MIX */}
      <div className="grid xl:grid-cols-3 gap-5 dashboard-main-grid">
        <section className="card dashboard-panel p-5 sm:p-6 xl:col-span-2">
          <div className="dashboard-panel-heading">
            <div className="flex items-center gap-3 min-w-0">
              <div className="dashboard-panel-icon dashboard-icon-indigo" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none"><circle cx="9" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6"/><path d="M2.5 20c.5-3.5 2.8-5.5 6.5-5.5s6 2 6.5 5.5M17 5.5a3.5 3.5 0 0 1 0 6.7M18 15c2 .6 3.2 2.2 3.5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Active sessions</h2>
                <p className="text-xs text-slate-500 mt-1">Customers currently using the workspace</p>
              </div>
            </div>
            <Link href="/bookings" className="dashboard-view-link">View all <span aria-hidden="true">↗</span></Link>
          </div>

          {activeSessionsRows.length === 0 ? (
            <div className="dashboard-empty-state">
              <div className="dashboard-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="25" height="25" fill="none"><circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5"/><path d="M4.5 20c.7-4 3.2-6 7.5-6s6.8 2 7.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></div>
              <div className="font-semibold text-slate-700">No active sessions right now</div>
              <p className="text-xs text-slate-400 mt-1">New check-ins will appear here as they start.</p>
              <Link href="/bookings" className="btn btn-primary mt-4">Start a session <span aria-hidden="true">→</span></Link>
            </div>
          ) : (
            <div className="dashboard-session-list divide-soft">
              {(activeSessionsRows as ActiveSessionRow[]).map((session) => {
                const startedAt = new Date(session.checkedInAt).getTime();
                const elapsedMs = Math.max(0, Date.now() - startedAt);
                const elapsedHours = elapsedMs / 3_600_000;
                const isPackage = session.billingMode === "package";
                const seatCharge = isPackage
                  ? 0
                  : calculateCustomerSessionSeatCharge(Math.max(1, Math.ceil(elapsedHours)), sessionPricing);
                const ordersTotal = safeNumber(session.ordersTotal);
                const discount = safeNumber(session.discount);
                const currentTotal = Math.max(0, seatCharge + ordersTotal - discount);
                return (
                  <Link key={session.id} href={`/bookings/${session.id}`} className="dashboard-session-row">
                    <div className="dashboard-customer-avatar">{session.customerName.charAt(0).toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-800 truncate text-sm">{session.customerName}</div>
                      <div className="text-xs text-slate-500 mt-1">Session #{session.id}<span className="mx-1.5 text-slate-300">·</span>Started {new Date(session.checkedInAt).toLocaleTimeString("en-EG", { timeZone: activeTimeZone(), hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="dashboard-active-status"><span /> Active</div>
                      <div className="text-sm font-extrabold text-indigo-600 mt-1.5 tabular-nums">{formatMoney(currentTotal, currency)}</div>
                    </div>
                    <svg className="dashboard-row-chevron" viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true"><path d="m7 4 6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="card dashboard-panel p-5 sm:p-6">
          <div className="dashboard-panel-heading mb-5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="dashboard-panel-icon dashboard-icon-cyan" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none"><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.6"/><path d="M3 10h18M7 15h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Payment mix</h2>
                <p className="text-xs text-slate-500 mt-1">How today&apos;s sales were paid</p>
              </div>
            </div>
          </div>
          {paymentBreakdownCombined.length === 0 ? (
            <div className="dashboard-payment-empty">Payments will be summarized here once your first sale is recorded.</div>
          ) : (
            <div className="space-y-4">
              {paymentBreakdownCombined.map((payment, index) => {
                const method = payment.method;
                const amount = safeNumber(payment.total);
                const percent = paymentTotal > 0 ? Math.round((amount / paymentTotal) * 100) : 0;
                const label = method === "cash" ? "Cash" : method === "visa" ? "Visa" : method === "instapay" ? "InstaPay" : method === "balance" ? "Customer balance" : method === "bank" ? "Bank" : method === "card" ? "Card" : method || "Unknown";
                const icon = method === "cash" ? "₵" : method === "visa" || method === "card" ? "▰" : method === "instapay" ? "↗" : method === "bank" ? "⌂" : "◈";
                const tone = ["payment-tone-indigo", "payment-tone-cyan", "payment-tone-violet", "payment-tone-amber", "payment-tone-emerald"][index % 5];
                return (
                  <div key={payment.method ?? "unknown"} className="dashboard-payment-row">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`dashboard-payment-icon ${tone}`} aria-hidden="true">{icon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-700 truncate">{label}</span>
                          <span className="text-[10px] font-extrabold text-slate-500 tabular-nums">{percent}%</span>
                        </div>
                        <div className="dashboard-payment-track"><span className={tone} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>
                        <div className="text-xs text-slate-500 mt-1.5 tabular-nums">{formatMoney(amount, currency)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="dashboard-payment-total"><span>Total collected</span><strong className="tabular-nums">{formatMoney(paymentTotal, currency)}</strong></div>
            </div>
          )}
        </section>
      </div>

      {/* RECENT ACTIVITY */}
      <section className="card dashboard-panel p-5 sm:p-6">
        <div className="dashboard-panel-heading mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="dashboard-panel-icon dashboard-icon-violet" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none"><path d="M4 4h16v16H4z" stroke="currentColor" strokeWidth="1.6"/><path d="M8 8h8M8 12h8M8 16h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">Recent sessions</h2>
              <p className="text-xs text-slate-500 mt-1">Latest completed customer visits</p>
            </div>
          </div>
          <Link href="/bookings" className="dashboard-view-link">All bookings <span aria-hidden="true">↗</span></Link>
        </div>

        {recentSessions.length === 0 ? (
          <div className="dashboard-empty-state compact">
            <div className="dashboard-empty-icon" aria-hidden="true">⌁</div>
            <div className="font-semibold text-slate-700">No completed sessions yet</div>
            <p className="text-xs text-slate-400 mt-1">Completed bookings will show here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto dashboard-table-wrap">
            <table className="w-full text-sm dashboard-recent-table">
              <thead><tr className="text-left text-slate-500 text-xs uppercase"><th className="py-3 px-3">Customer</th><th className="py-3 px-3">Session</th><th className="py-3 px-3">Payment</th><th className="py-3 px-3">Completed</th><th className="py-3 px-3 text-right">Total</th></tr></thead>
              <tbody>
                {recentSessions.map((session) => (
                  <tr key={session.id} className="border-t border-slate-100">
                    <td className="py-3.5 px-3"><div className="flex items-center gap-3 min-w-0"><span className="dashboard-table-avatar">{session.customerName.charAt(0).toUpperCase()}</span><span className="font-bold text-slate-700 truncate">{session.customerName}</span></div></td>
                    <td className="py-3.5 px-3"><span className="dashboard-session-ref">#{session.id}</span></td>
                    <td className="py-3.5 px-3"><span className="dashboard-payment-method">{session.paymentMethod || "—"}</span></td>
                    <td className="py-3.5 px-3 text-slate-500">{session.checkedOutAt ? new Date(session.checkedOutAt).toLocaleString("en-EG", { timeZone: activeTimeZone(), day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="py-3.5 px-3 text-right font-extrabold text-slate-800 tabular-nums">{formatMoney(safeNumber(session.total), currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* SHORTCUTS */}
      <section className="dashboard-shortcuts" aria-label="Quick access">
        <Link href="/meeting-rooms" className="dashboard-shortcut"><span className="dashboard-shortcut-icon shortcut-indigo" aria-hidden="true">⌂</span><span><strong>Meeting rooms</strong><small>Manage room sessions</small></span><span className="dashboard-shortcut-arrow" aria-hidden="true">↗</span></Link>
        <Link href="/orders" className="dashboard-shortcut"><span className="dashboard-shortcut-icon shortcut-cyan" aria-hidden="true">↗</span><span><strong>Live orders</strong><small>Review incoming orders</small></span><span className="dashboard-shortcut-arrow" aria-hidden="true">↗</span></Link>
        <Link href="/customers" className="dashboard-shortcut"><span className="dashboard-shortcut-icon shortcut-violet" aria-hidden="true">♧</span><span><strong>Customers</strong><small>Browse customer records</small></span><span className="dashboard-shortcut-arrow" aria-hidden="true">↗</span></Link>
        {(user.role === "admin" || user.role === "manager") && (
          <Link href="/reports" className="dashboard-shortcut"><span className="dashboard-shortcut-icon shortcut-amber" aria-hidden="true">⌁</span><span><strong>Reports</strong><small>Explore business results</small></span><span className="dashboard-shortcut-arrow" aria-hidden="true">↗</span></Link>
        )}
      </section>
    </div>
  );
}
