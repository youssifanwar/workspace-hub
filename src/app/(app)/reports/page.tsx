import { PageBar, StatStrip, Panel } from "../_components/ui";
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
  customerMeetingRoomPackages,
  customerSubscriptions,
  expenses,
  manualIncomes,
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
import { activeTimeZone, getZonedDayRange, loadTimezone } from "@/lib/timezone";
import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";

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
    { timeZone: activeTimeZone() },
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
    { timeZone: activeTimeZone() },
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const f = makeFmt(await getLang());
  const tx = f.t;
  const user = await getCurrentUser();
  await loadTimezone();

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

  // Report windows follow the workspace timezone, not the hosting server's
  // timezone, so Cairo late-night sales are not silently assigned to yesterday.
  const { from, to } = getZonedDayRange(days, activeTimeZone());

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
          // Voided packages are already excluded from revenue; don't
          // subtract their cash refund from profit a second time.
          sql`${expenses.category} <> 'Package refund'`,
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

  const [otherPaymentRows, otherDailyRows] = await Promise.all([
    db.execute(sql`
      SELECT method, COALESCE(SUM(amount), 0) AS total
      FROM (
        SELECT payment_method AS method, price_snapshot AS amount
        FROM customer_subscriptions
        WHERE status <> 'cancelled' AND purchased_at >= ${from} AND purchased_at <= ${to}
        UNION ALL
        SELECT payment_method AS method, price_snapshot AS amount
        FROM customer_meeting_room_packages
        WHERE status <> 'cancelled' AND purchased_at >= ${from} AND purchased_at <= ${to}
        UNION ALL
        SELECT payment_method AS method, amount
        FROM manual_incomes
        WHERE created_at >= ${from} AND created_at <= ${to}
      ) other_sources
      GROUP BY method
    `),
    db.execute(sql`
      SELECT day, COALESCE(SUM(revenue), 0) AS revenue
      FROM (
        SELECT to_char(date_trunc('day', purchased_at), 'YYYY-MM-DD') AS day,
               COALESCE(SUM(price_snapshot), 0) AS revenue
        FROM customer_subscriptions
        WHERE status <> 'cancelled' AND purchased_at >= ${from} AND purchased_at <= ${to}
        GROUP BY date_trunc('day', purchased_at)
        UNION ALL
        SELECT to_char(date_trunc('day', purchased_at), 'YYYY-MM-DD') AS day,
               COALESCE(SUM(price_snapshot), 0) AS revenue
        FROM customer_meeting_room_packages
        WHERE status <> 'cancelled' AND purchased_at >= ${from} AND purchased_at <= ${to}
        GROUP BY date_trunc('day', purchased_at)
        UNION ALL
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
               COALESCE(SUM(amount), 0) AS revenue
        FROM manual_incomes
        WHERE created_at >= ${from} AND created_at <= ${to}
        GROUP BY date_trunc('day', created_at)
      ) other_daily
      GROUP BY day
    `),
  ]);

  // Package sales (desk + meeting room) counted by PAYMENT date, and manual
  // income entered on the Expenses & Income page.
  const [deskPackageRow, meetingPackageRow, manualIncomeRow] =
    await Promise.all([
      db
        .select({
          total: sql<string>`coalesce(sum(${customerSubscriptions.priceSnapshot}), 0)`,
        })
        .from(customerSubscriptions)
        .where(
          and(
            sql`${customerSubscriptions.status} <> 'cancelled'`,
            gte(customerSubscriptions.purchasedAt, from),
            lte(customerSubscriptions.purchasedAt, to),
          ),
        ),
      db
        .select({
          total: sql<string>`coalesce(sum(${customerMeetingRoomPackages.priceSnapshot}), 0)`,
        })
        .from(customerMeetingRoomPackages)
        .where(
          and(
            sql`${customerMeetingRoomPackages.status} <> 'cancelled'`,
            gte(customerMeetingRoomPackages.purchasedAt, from),
            lte(customerMeetingRoomPackages.purchasedAt, to),
          ),
        ),
      db
        .select({
          total: sql<string>`coalesce(sum(${manualIncomes.amount}), 0)`,
        })
        .from(manualIncomes)
        .where(
          and(
            gte(manualIncomes.createdAt, from),
            lte(manualIncomes.createdAt, to),
          ),
        ),
    ]);
  const packageSales =
    safeNumber(deskPackageRow[0]?.total) +
    safeNumber(meetingPackageRow[0]?.total);
  const manualIncomeTotal = safeNumber(manualIncomeRow[0]?.total);

  const directFnbRevenue = safeNumber(
    (directFnbRevenueRow as { rows?: Array<Record<string, unknown>> }).rows?.[0]?.total,
  );

  const bookingRevenue = safeNumber(
    revenueRow[0]?.revenue,
  );

  const revenue =
    bookingRevenue +
    directFnbRevenue +
    packageSales +
    manualIncomeTotal;

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

  const otherDailyMap = new Map(
    ((otherDailyRows as { rows?: Array<Record<string, unknown>> }).rows ?? []).map((row) => [
      String(row.day ?? ""),
      safeNumber(row.revenue),
    ]),
  );
  const dailyRevenueMap = new Map<string, number>();
  for (const row of dailyRows) dailyRevenueMap.set(row.day, safeNumber(row.revenue));
  for (const [day, value] of directFnbDailyMap) {
    dailyRevenueMap.set(day, (dailyRevenueMap.get(day) ?? 0) + value);
  }
  for (const [day, value] of otherDailyMap) {
    dailyRevenueMap.set(day, (dailyRevenueMap.get(day) ?? 0) + value);
  }
  const dailyRowsMerged = Array.from(dailyRevenueMap, ([day, revenue]) => ({ day, revenue }))
    .sort((a, b) => a.day.localeCompare(b.day));

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
  for (const row of (otherPaymentRows as { rows?: Array<Record<string, unknown>> }).rows ?? []) {
    const method = String(row.method ?? "unknown");
    combinedPaymentMap.set(method, (combinedPaymentMap.get(method) ?? 0) + safeNumber(row.total));
  }
  const combinedPaymentRows = Array.from(combinedPaymentMap, ([method, total]) => ({ method, total }));

  const averageBooking =
    bookingCount > 0
      ? bookingRevenue / bookingCount
      : 0;

  const netProfit =
    revenue - totalExpenses;

  const payLabel = (method: string | null) =>
    method === "cash" ? tx("💵 Cash")
    : method === "visa" ? tx("💳 Visa")
    : method === "instapay" ? tx("📱 InstaPay")
    : method === "balance" ? tx("👛 Customer balance")
    : method === "bank" ? tx("🏦 Bank")
    : method === "card" ? tx("💳 Card")
    : method ? method : tx("Unknown");
  const topRevenue = mergedTopProducts.reduce((n, p) => n + safeNumber(p.revenue), 0) || 1;

  return (
    <div>
      <PageBar
        crumb={tx("Insights")}
        title={tx("Reports")}
        description={
          <>
            {formatDate(from)} → {formatDate(to)} ·{" "}
            {f.en ? `Last ${days} days` : `آخر ${days} يوم`}
          </>
        }
        actions={
          <div className="x-tabs">
            {[1, 7, 30, 90].map((range) => (
              <Link
                key={range}
                href={`/reports?range=${range}`}
                aria-current={days === range ? "page" : undefined}
                className={`x-tab ${days === range ? "active" : ""}`}
              >
                {range === 1 ? tx("Today") : f.en ? `${range}d` : `${range} يوم`}
              </Link>
            ))}
          </div>
        }
      />

      <div className="v2-hero">
        <div className="v2-hero-main">
          <span className="v2-hero-label">{tx("Net profit")}</span>
          <span className={`v2-hero-value ${netProfit >= 0 ? "pos" : "neg"}`}>
            {formatMoney(netProfit, currency)}
          </span>
          <span className="v2-hero-sub">
            {tx("Revenue")} {formatMoney(revenue, currency)} · {tx("Expenses")} {formatMoney(totalExpenses, currency)}
          </span>
        </div>
        <StatStrip
          items={[
            { label: tx("Revenue"), value: formatMoney(revenue, currency), hint: `${f.en ? "Packages" : "الباقات"} ${formatMoney(packageSales, currency)} · ${f.en ? "Other income" : "إيرادات أخرى"} ${formatMoney(manualIncomeTotal, currency)}`, tone: "green" },
            { label: tx("Seat charges"), value: formatMoney(seatTotal, currency), tone: "brand" },
            { label: f.en ? "F&B · sessions + Direct POS" : "أكل وشرب · الجلسات + البيع المباشر", value: formatMoney(ordersTotal, currency), hint: `${f.en ? "Direct POS" : "البيع المباشر"} ${formatMoney(directFnbRevenue, currency)} ${f.en ? "included" : "مشمول"}`, tone: "amber" },
            { label: tx("Expenses"), value: formatMoney(totalExpenses, currency), tone: "red" },
          ]}
        />
      </div>

      <div className="v2-split">
        <Panel
          title={tx("Daily revenue")}
          meta={`${bookingCount} ${f.en ? "bookings" : "حجز"} · ${f.en ? "Avg" : "المتوسط"} ${formatMoney(averageBooking, currency)} ${f.en ? "per booking" : "للحجز"}`}
        >
          {dailyRowsMerged.length === 0 ? (
            <div className="v2-empty">{tx("No data")}</div>
          ) : (
            <div className="v2-chart" aria-label={tx("Daily revenue chart")}>
              {dailyRowsMerged.map((row) => {
                const value = safeNumber(row.revenue);
                const height = Math.min(100, Math.max(0, (value / maxDaily) * 100));
                return (
                  <div key={row.day} className="v2-chart-col">
                    <span className="v2-chart-val">{value.toFixed(0)}</span>
                    <div className="v2-chart-track">
                      <div
                        className="v2-chart-bar"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${row.day}: ${value.toFixed(2)} ${currency}`}
                        role="img"
                        aria-label={`${row.day}: ${value.toFixed(2)} ${currency}`}
                      />
                    </div>
                    <span className="v2-chart-day">{row.day.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title={tx("Payment methods")}>
          {combinedPaymentRows.length === 0 ? (
            <div className="v2-empty">{tx("No sales")}</div>
          ) : (
            <div className="v2-bars">
              {combinedPaymentRows.map((payment) => {
                const value = safeNumber(payment.total);
                const pct = revenue > 0 ? Math.min(100, Math.max(0, (value / revenue) * 100)) : 0;
                return (
                  <div key={payment.method ?? "unknown"} className="v2-bar-row">
                    <div className="v2-bar-top">
                      <span>{payLabel(payment.method)}</span>
                      <b>{formatMoney(value, currency)}</b>
                    </div>
                    <div className="v2-meter"><i style={{ width: `${pct}%` }} /></div>
                    <small>{pct.toFixed(0)}%</small>
                  </div>
                );
              })}
            </div>
          )}
          <div className="v2-kv">
            <div><span>{tx("Bank deposits")}</span><b>{formatMoney(bankDeposits, currency)}</b></div>
            <div><span>{tx("Bank withdrawals")}</span><b>{formatMoney(bankWithdrawals, currency)}</b></div>
          </div>
        </Panel>
      </div>

      <div className="v2-split" style={{ marginTop: 20 }}>
        <Panel title={tx("Top selling products")} flush>
          {mergedTopProducts.length === 0 ? (
            <div className="v2-empty">{tx("No sales yet")}</div>
          ) : (
            <div className="x-table-wrap">
              <table className="v2-tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{tx("Product")}</th>
                    <th>{tx("Units")}</th>
                    <th>{tx("Share")}</th>
                    <th className="num">{tx("Revenue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {mergedTopProducts.map((product, index) => {
                    const revenueValue = safeNumber(product.revenue);
                    const quantity = Number(product.qty) || 0;
                    const share = (revenueValue / topRevenue) * 100;
                    return (
                      <tr key={`${product.name}-${index}`}>
                        <td className="muted">{index + 1}</td>
                        <td><b>{product.name}</b></td>
                        <td className="muted">{quantity}</td>
                        <td style={{ minWidth: 120 }}>
                          <div className="v2-meter"><i style={{ width: `${share}%` }} /></div>
                        </td>
                        <td className="num">{formatMoney(revenueValue, currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title={tx("Recent shifts")} flush>
          {shiftRows.length === 0 ? (
            <div className="v2-empty">{tx("No shifts")}</div>
          ) : (
            <div className="v2-list">
              {shiftRows.map((shift) => (
                <Link key={shift.id} href={`/shift/summary/${shift.id}`} className="v2-list-row">
                  <div>
                    <b>{f.en ? "Shift" : "شيفت"} #{shift.id} · {shift.userName}</b>
                    <small>{formatDateTime(shift.openedAt)}</small>
                  </div>
                  <span className="v2-link">{tx("View →")}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
