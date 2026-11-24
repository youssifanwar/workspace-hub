import { redirect } from "next/navigation";
import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  bankTransactions,
  bookings,
  customerMeetingRoomPackages,
  customers,
  customerSubscriptions,
  desks,
  expenses,
  manualIncomes,
  meetingRoomReservations,
  orderTickets,
  bookingItems,
  products,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";
import Icon from "../_components/Icon";
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
  const f = makeFmt(await getLang());
  const t = f.t;
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

  const tz = activeTimeZone();

  // Last 7 days of revenue (sessions + direct F&B), used for the bar chart.
  const weekRows = await db.execute(sql`
    select to_char(day, 'YYYY-MM-DD') as day, sum(total) as total from (
      select (checked_out_at at time zone ${tz})::date as day, total from bookings
        where status = 'closed' and checked_out_at >= now() - interval '8 days'
      union all
      select (created_at at time zone ${tz})::date as day, total from fnb_sales
        where created_at >= now() - interval '8 days'
      union all
      select (purchased_at at time zone ${tz})::date as day, price_snapshot as total from customer_subscriptions
        where status <> 'cancelled' and purchased_at >= now() - interval '8 days'
      union all
      select (created_at at time zone ${tz})::date as day, amount as total from manual_incomes
        where created_at >= now() - interval '8 days'
    ) x group by day order by day
  `);
  const weekMap = new Map<string, number>();
  for (const r of weekRows.rows ?? []) {
    weekMap.set(String((r as { day: unknown }).day), safeNumber((r as { total: unknown }).total));
  }
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const week: { key: string; label: string; value: number; today: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
    week.push({
      key,
      label: i === 0 ? t("النهارده") : f.weekday(d, tz),
      value: weekMap.get(key) ?? 0,
      today: key === todayKey,
    });
  }
  const weekMax = Math.max(1, ...week.map((w) => w.value));
  const weekTotal = week.reduce((a, w) => a + w.value, 0);

  const [liveTickets, lowStock, upcoming, todayTicketsRow, deskCountRow] = await Promise.all([
    db
      .select({
        id: orderTickets.id,
        number: orderTickets.ticketNumber,
        status: orderTickets.status,
        deskName: desks.name,
        itemCount: sql<number>`coalesce((select sum(quantity) from ${bookingItems} where ${bookingItems.ticketId} = ${orderTickets.id}), 0)::int`,
      })
      .from(orderTickets)
      .innerJoin(desks, eq(desks.id, orderTickets.deskId))
      .where(inArray(orderTickets.status, ["pending", "printed"]))
      .orderBy(desc(orderTickets.createdAt))
      .limit(4),
    db
      .select({ id: products.id, name: products.name, icon: products.icon, stock: products.stockQuantity })
      .from(products)
      .where(and(eq(products.active, true), lte(products.stockQuantity, 5)))
      .orderBy(asc(products.stockQuantity))
      .limit(4),
    db
      .select({
        id: meetingRoomReservations.id,
        startAt: meetingRoomReservations.startAt,
        attendees: meetingRoomReservations.attendeeCount,
        customerName: customers.name,
        roomName: desks.name,
      })
      .from(meetingRoomReservations)
      .innerJoin(customers, eq(customers.id, meetingRoomReservations.customerId))
      .innerJoin(desks, eq(desks.id, meetingRoomReservations.deskId))
      .where(and(gte(meetingRoomReservations.startAt, new Date()), sql`${meetingRoomReservations.status} <> 'cancelled'`))
      .orderBy(asc(meetingRoomReservations.startAt))
      .limit(4),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(orderTickets)
      .where(and(gte(orderTickets.createdAt, startOfDay), lte(orderTickets.createdAt, endOfDay), sql`${orderTickets.status} <> 'cancelled'`)),
    db.select({ c: sql<number>`count(*)::int` }).from(desks).where(eq(desks.active, true)),
  ]);

  const paymentTotal = paymentBreakdownCombined.reduce((sum, p) => sum + safeNumber(p.total), 0);
  const palette = ["#2563eb", "#0f766e", "#f59e0b", "#7c3aed", "#ec4899"];
  let acc = 0;
  const stops = paymentBreakdownCombined.map((p, i) => {
    const share = paymentTotal > 0 ? (safeNumber(p.total) / paymentTotal) * 100 : 0;
    const from = acc;
    acc += share;
    return `${palette[i % palette.length]} ${from}% ${acc}%`;
  });
  const donut = stops.length ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(#e2e8f0 0 100%)";

  const firstName = user.fullName.trim().split(/\s+/)[0] || user.fullName;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
  const greeting = hour < 12 ? t("صباح الخير") : t("مساء الخير");
  const todayCount = Number(todayTicketsRow[0]?.c ?? 0);
  const roomsTotal = Number(deskCountRow[0]?.c ?? 0);
  const occupied = activeCount + activeMeetingRoomsCount;
  const occupancy = roomsTotal > 0 ? Math.min(100, Math.round((occupied / Math.max(roomsTotal, occupied)) * 100)) : 0;

  return (
    <div className="x-page space-y-5">
      <div className="x-head">
        <div>
          <h1>{greeting}{f.en ? "," : "،"} {firstName} 👋</h1>
          <p>{f.longDate(new Date(), tz)} · {t("ده ملخص اللي بيحصل دلوقتي")}</p>
        </div>
        <div className="x-actions">
          <Link href="/bookings" className="x-btn primary">{t("+ جلسة جديدة")}</Link>
          <Link href="/meeting-rooms/calendar" className="x-btn">{t("حجز غرفة")}</Link>
          <Link href="/shift" className="x-btn dark">{t("الشيفت")}</Link>
        </div>
      </div>

      <section className="x-grid x-kpis" aria-label={t("أرقام النهارده")}>
        <div className="x-card x-kpi">
          <div className="x-kpi-top"><span className="x-kpi-label">{t("إيراد النهارده")}</span><span className="x-kpi-ico tone-blue"><Icon name="cash" size={19} /></span></div>
          <div className="x-kpi-value x-num">{f.number(todayRevenue)}<small>{f.cur}</small></div>
          <div className="x-row-sub">{t("صافي بعد المصاريف:")} {f.money(netRevenue)}</div>
        </div>
        <div className="x-card x-kpi">
          <div className="x-kpi-top"><span className="x-kpi-label">{t("جلسات شغالة")}</span><span className="x-kpi-ico tone-green"><Icon name="users" size={19} /></span></div>
          <div className="x-kpi-value x-num">{activeCount}<small>{t("جلسة")}</small></div>
          <div className="x-row-sub">{f.en ? `and ${activeMeetingRoomsCount} meeting rooms in use` : `و ${activeMeetingRoomsCount} غرفة اجتماعات مستخدمة`}</div>
        </div>
        <div className="x-card x-kpi">
          <div className="x-kpi-top"><span className="x-kpi-label">{t("طلبات المشروبات")}</span><span className="x-kpi-ico tone-amber"><Icon name="utensils" size={19} /></span></div>
          <div className="x-kpi-value x-num">{todayCount}<small>{t("طلب النهارده")}</small></div>
          <div className="x-row-sub">{liveTickets.length > 0 ? (f.en ? `${liveTickets.length} still active` : `${liveTickets.length} لسه شغالين`) : t("مفيش طلبات معلقة")}</div>
        </div>
        <div className="x-card x-kpi">
          <div className="x-kpi-top"><span className="x-kpi-label">{t("إشغال المكان")}</span><span className="x-kpi-ico tone-violet"><Icon name="building" size={19} /></span></div>
          <div className="x-kpi-value x-num">{occupancy}%</div>
          <div className="x-row-sub">{occupied} {t("من")} {roomsTotal} {t("مكان")}</div>
        </div>
      </section>

      <div className="x-grid x-cols-2">
        <section className="x-card">
          <div className="x-card-head">
            <h2>{t("الإيراد آخر 7 أيام")}</h2>
            <span className="x-pill blue x-num">{t("الإجمالي")} {f.money(weekTotal)}</span>
          </div>
          <div className="x-bars" role="img" aria-label={t("رسم بياني للإيراد اليومي")}>
            {week.map((w) => (
              <div key={w.key} className={`x-bar ${w.today ? "today" : ""}`}>
                <span className="x-bar-val x-num">{w.value >= 1000 ? `${(w.value / 1000).toFixed(1)}k` : Math.round(w.value)}</span>
                <div className="x-bar-fill" style={{ height: `${Math.max(2, (w.value / weekMax) * 100)}%` }} />
                <span className="x-bar-lbl">{w.label}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-4">
          <section className="x-card">
            <div className="x-card-head"><h2>{t("طرق دفع النهارده")}</h2></div>
            {paymentBreakdownCombined.length === 0 ? (
              <div className="x-empty">{t("لسه مفيش مبيعات النهارده.")}</div>
            ) : (
              <div className="flex items-center gap-5">
                <div className="x-donut" style={{ background: donut, borderRadius: 999 }}>
                  <div className="x-donut-hole"><div><b className="x-num" style={{ fontSize: 20 }}>{f.number(paymentTotal)}</b><div className="x-row-sub">{f.cur}</div></div></div>
                </div>
                <div className="x-legend">
                  {paymentBreakdownCombined.map((p, i) => (
                    <div key={p.method ?? "unknown"} className="x-legend-row">
                      <span><i className="x-sw" style={{ background: palette[i % palette.length] }} />{f.pay(p.method)}</span>
                      <span className="x-num">{f.number(safeNumber(p.total))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="x-card">
            <div className="x-card-head"><h2>{t("الطلبات الحية")}</h2><Link href="/orders" className="x-link">{t("افتح لوحة الطلبات ←")}</Link></div>
            {liveTickets.length === 0 ? (
              <div className="x-empty">{t("مفيش طلبات دلوقتي.")}</div>
            ) : (
              <div className="x-list">
                {liveTickets.map((tk) => (
                  <div key={tk.id} className="x-row">
                    <span className="x-row-title x-num">#{String(tk.number).padStart(3, "0")}</span>
                    <div className="x-row-main"><div className="x-row-sub" style={{ marginTop: 0 }}>{tk.deskName} · {tk.itemCount} {t("أصناف")}</div></div>
                    <span className={`x-pill ${tk.status === "pending" ? "amber" : "blue"}`}>{tk.status === "pending" ? t("جديد") : t("بيتحضّر")}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="x-grid x-cols-3">
        <section className="x-card">
          <div className="x-card-head"><h2>{t("الجلسات الشغالة")}</h2><Link href="/bookings" className="x-link">{t("الكل ←")}</Link></div>
          {activeSessionsRows.length === 0 ? (
            <div className="x-empty">{t("مفيش جلسات شغالة دلوقتي.")}</div>
          ) : (
            <div className="x-list">
              {(activeSessionsRows as ActiveSessionRow[]).slice(0, 5).map((session) => {
                const elapsedHours = Math.max(0, Date.now() - new Date(session.checkedInAt).getTime()) / 3_600_000;
                const seatCharge = session.billingMode === "package" ? 0 : calculateCustomerSessionSeatCharge(Math.max(1, Math.ceil(elapsedHours)), sessionPricing);
                const currentTotal = Math.max(0, seatCharge + safeNumber(session.ordersTotal) - safeNumber(session.discount));
                return (
                  <Link key={session.id} href={`/bookings/${session.id}`} className="x-row" style={{ textDecoration: "none" }}>
                    <span className="x-kpi-ico tone-blue" style={{ width: 34, height: 34 }}>{session.customerName.charAt(0)}</span>
                    <div className="x-row-main"><div className="x-row-title">{session.customerName}</div><div className="x-row-sub">{t("بدأ")} {f.time(session.checkedInAt, tz)}</div></div>
                    <b className="x-num" style={{ color: "#1d4ed8" }}>{f.money(currentTotal)}</b>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="x-card">
          <div className="x-card-head"><h2>{t("مخزون قرب يخلص")}</h2><Link href="/menu" className="x-link">{t("المخزون")}</Link></div>
          {lowStock.length === 0 ? (
            <div className="x-empty">{t("كل الأصناف مخزونها كويس.")}</div>
          ) : (
            <div className="space-y-2">
              {lowStock.map((p) => (
                <div key={p.id} className="x-row" style={{ background: p.stock === 0 ? "#fef2f2" : "#fffbeb", border: `1px solid ${p.stock === 0 ? "#fecaca" : "#fde68a"}`, borderRadius: 12, padding: "10px 12px" }}>
                  <span style={{ fontSize: 20 }}>{p.icon}</span>
                  <div className="x-row-main x-row-title">{p.name}</div>
                  <span className={`x-pill ${p.stock === 0 ? "red" : "amber"}`}>{p.stock === 0 ? t("خلص") : `${t("باقي")} ${p.stock}`}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="x-card">
          <div className="x-card-head"><h2>{t("الحجوزات الجاية")}</h2><Link href="/meeting-rooms/calendar" className="x-link">{t("التقويم")}</Link></div>
          {upcoming.length === 0 ? (
            <div className="x-empty">{t("مفيش حجوزات جاية.")}</div>
          ) : (
            <div className="x-list">
              {upcoming.map((r) => (
                <div key={r.id} className="x-row">
                  <span className="x-pill" style={{ background: "#0f172a", color: "#fff", padding: "6px 10px" }}>{f.time(r.startAt, tz)}</span>
                  <div className="x-row-main"><div className="x-row-title">{r.customerName}</div><div className="x-row-sub">{r.roomName} · {r.attendees} {t("أفراد")} · {f.date(r.startAt, tz)}</div></div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="x-card">
        <div className="x-card-head"><h2>{t("آخر الجلسات المقفولة")}</h2><Link href="/bookings" className="x-link">{t("كل الحجوزات ←")}</Link></div>
        {recentSessions.length === 0 ? (
          <div className="x-empty">{t("لسه مفيش جلسات اتقفلت.")}</div>
        ) : (
          <div className="x-table-wrap">
            <table className="x-table">
              <thead><tr><th>{t("العميل")}</th><th>{t("الجلسة")}</th><th>{t("الدفع")}</th><th>{t("اتقفلت")}</th><th>{t("الإجمالي")}</th></tr></thead>
              <tbody>
                {recentSessions.map((s) => (
                  <tr key={s.id}>
                    <td className="font-bold">{s.customerName}</td>
                    <td className="x-num">#{s.id}</td>
                    <td><span className="x-pill">{f.pay(s.paymentMethod)}</span></td>
                    <td className="x-num">{s.checkedOutAt ? `${f.date(s.checkedOutAt, tz)} · ${f.time(s.checkedOutAt, tz)}` : "—"}</td>
                    <td className="font-bold x-num">{f.money(safeNumber(s.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
