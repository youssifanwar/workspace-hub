import { db } from "@/db";
import {
  bookings,
  bookingItems,
  expenses,
  bankTransactions,
  users,
  shifts,
} from "@/db/schema";
import { sql, eq, and, gte, lte, desc, isNotNull } from "drizzle-orm";
import { getCurrentUser, canManage } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSetting, formatMoney } from "@/lib/settings";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManage(user.role)) redirect("/dashboard");
  const currency = await getSetting("currency");

  const { range = "7" } = await searchParams;
  const days = Math.max(1, Math.min(90, parseInt(range) || 7));
  const from = new Date();
  from.setDate(from.getDate() - days + 1);
  from.setHours(0, 0, 0, 0);
  const to = new Date();

  const [
    revenueRow,
    dailyRows,
    topProducts,
    expensesRow,
    bankRow,
    paymentRows,
    shiftRows,
  ] = await Promise.all([
    db
      .select({
        revenue: sql<string>`coalesce(sum(${bookings.total}), 0)`,
        seat: sql<string>`coalesce(sum(${bookings.seatCharge}), 0)`,
        orders: sql<string>`coalesce(sum(${bookings.ordersTotal}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "closed"),
          gte(bookings.checkedInAt, from),
          lte(bookings.checkedInAt, to),
        ),
      ),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${bookings.checkedInAt}), 'YYYY-MM-DD')`,
        revenue: sql<string>`coalesce(sum(${bookings.total}), 0)`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "closed"),
          gte(bookings.checkedInAt, from),
        ),
      )
      .groupBy(sql`date_trunc('day', ${bookings.checkedInAt})`)
      .orderBy(sql`date_trunc('day', ${bookings.checkedInAt})`),
    db
      .select({
        name: bookingItems.nameSnapshot,
        qty: sql<number>`sum(${bookingItems.quantity})::int`,
        revenue: sql<string>`coalesce(sum(${bookingItems.quantity} * ${bookingItems.unitPrice}), 0)`,
      })
      .from(bookingItems)
      .innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
      .where(
        and(
          eq(bookings.status, "closed"),
          gte(bookings.checkedInAt, from),
        ),
      )
      .groupBy(bookingItems.nameSnapshot)
      .orderBy(desc(sql`sum(${bookingItems.quantity})`))
      .limit(10),
    db
      .select({ total: sql<string>`coalesce(sum(amount), 0)` })
      .from(expenses)
      .where(gte(expenses.createdAt, from)),
    db
      .select({
        deposits: sql<string>`coalesce(sum(case when type='deposit' then amount else 0 end), 0)`,
        withdrawals: sql<string>`coalesce(sum(case when type='withdraw' then amount else 0 end), 0)`,
      })
      .from(bankTransactions)
      .where(gte(bankTransactions.createdAt, from)),
    db
      .select({
        method: bookings.paymentMethod,
        total: sql<string>`coalesce(sum(${bookings.total}), 0)`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "closed"),
          gte(bookings.checkedInAt, from),
        ),
      )
      .groupBy(bookings.paymentMethod),
    db
      .select({
        id: shifts.id,
        userName: users.fullName,
        openedAt: shifts.openedAt,
        closedAt: shifts.closedAt,
        openingCash: shifts.openingCash,
        closingCash: shifts.closingCash,
      })
      .from(shifts)
      .innerJoin(users, eq(users.id, shifts.userId))
      .where(and(isNotNull(shifts.closedAt), gte(shifts.openedAt, from)))
      .orderBy(desc(shifts.openedAt))
      .limit(20),
  ]);

  const revenue = parseFloat(revenueRow[0]?.revenue || "0");
  const totalExpenses = parseFloat(expensesRow[0]?.total || "0");
  const seatTotal = parseFloat(revenueRow[0]?.seat || "0");
  const ordersTotal = parseFloat(revenueRow[0]?.orders || "0");
  const bookingCount = revenueRow[0]?.count || 0;
  const bankDeposits = parseFloat(bankRow[0]?.deposits || "0");
  const bankWithdrawals = parseFloat(bankRow[0]?.withdrawals || "0");

  const maxDaily = Math.max(1, ...dailyRows.map((d) => parseFloat(d.revenue)));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Reports</h1>
          <p className="text-slate-500">
            {from.toLocaleDateString()} → {to.toLocaleDateString()} · Last {days} days
          </p>
        </div>
        <div className="flex gap-1">
          {[1, 7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`/reports?range=${d}`}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                days === d ? "bg-indigo-600 text-white" : "bg-white border border-slate-200"
              }`}
            >
              {d === 1 ? "Today" : `${d}d`}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="kpi bg-gradient-to-br from-emerald-500 to-teal-500">
          <div className="text-xs uppercase text-white/80 font-semibold">Revenue</div>
          <div className="text-2xl font-bold mt-2">{formatMoney(revenue, currency)}</div>
        </div>
        <div className="kpi bg-gradient-to-br from-indigo-500 to-purple-500">
          <div className="text-xs uppercase text-white/80 font-semibold">Seat charges</div>
          <div className="text-2xl font-bold mt-2">{formatMoney(seatTotal, currency)}</div>
        </div>
        <div className="kpi bg-gradient-to-br from-orange-500 to-pink-500">
          <div className="text-xs uppercase text-white/80 font-semibold">F&B</div>
          <div className="text-2xl font-bold mt-2">{formatMoney(ordersTotal, currency)}</div>
        </div>
        <div className="kpi bg-gradient-to-br from-rose-500 to-red-500">
          <div className="text-xs uppercase text-white/80 font-semibold">Expenses</div>
          <div className="text-2xl font-bold mt-2">{formatMoney(totalExpenses, currency)}</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card p-6 lg:col-span-2">
          <h3 className="font-bold mb-4">Daily revenue</h3>
          {dailyRows.length === 0 ? (
            <div className="text-center py-10 text-slate-400">No data</div>
          ) : (
            <div className="flex items-end gap-2 h-48">
              {dailyRows.map((d) => {
                const val = parseFloat(d.revenue);
                const h = (val / maxDaily) * 100;
                return (
                  <div
                    key={d.day}
                    className="flex-1 flex flex-col items-center gap-1 min-w-0"
                  >
                    <div className="text-[10px] text-slate-500 font-semibold tabular-nums">
                      {val.toFixed(0)}
                    </div>
                    <div
                      className="w-full rounded-t-lg bg-gradient-to-t from-indigo-600 to-cyan-400 min-h-[4px]"
                      style={{ height: `${h}%` }}
                      title={`${d.day}: ${val.toFixed(2)} ${currency}`}
                    />
                    <div className="text-[10px] text-slate-500 truncate w-full text-center">
                      {d.day.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 text-sm text-slate-500">
            {bookingCount} bookings · Avg{" "}
            {formatMoney(bookingCount ? revenue / bookingCount : 0, currency)}{" "}
            per booking
          </div>
        </div>

        <div className="card p-6">
          <h3 className="font-bold mb-4">Payment methods</h3>
          {paymentRows.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-6">No sales</div>
          ) : (
            <div className="space-y-2">
              {paymentRows.map((p) => {
                const label =
                  p.method === "cash"
                    ? "💵 Cash"
                    : p.method === "visa"
                    ? "💳 Visa"
                    : "📱 InstaPay";
                const val = parseFloat(p.total);
                const pct = revenue > 0 ? (val / revenue) * 100 : 0;
                return (
                  <div key={p.method}>
                    <div className="flex items-center justify-between text-sm">
                      <span>{label}</span>
                      <span className="font-bold">
                        {formatMoney(val, currency)}
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-cyan-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-slate-100 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-600">Bank deposits</span>
              <span className="font-semibold">
                {formatMoney(bankDeposits, currency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Bank withdrawals</span>
              <span className="font-semibold">
                {formatMoney(bankWithdrawals, currency)}
              </span>
            </div>
            <div className="flex justify-between text-base font-bold pt-2 border-t border-slate-100">
              <span>Net profit</span>
              <span className="text-emerald-600">
                {formatMoney(revenue - totalExpenses, currency)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="font-bold mb-4">Top selling products</h3>
          {topProducts.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">
              No sales yet
            </p>
          ) : (
            <div className="space-y-2">
              {topProducts.map((p, i) => (
                <div
                  key={p.name}
                  className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 grid place-items-center font-bold text-sm">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">
                      {p.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {p.qty} units
                    </div>
                  </div>
                  <div className="font-bold tabular-nums">
                    {formatMoney(parseFloat(p.revenue), currency)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-6">
          <h3 className="font-bold mb-4">Recent shifts</h3>
          {shiftRows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No shifts</p>
          ) : (
            <div className="divide-soft">
              {shiftRows.map((s) => (
                <Link
                  key={s.id}
                  href={`/shift/summary/${s.id}`}
                  className="py-2 flex items-center justify-between hover:bg-slate-50 rounded-lg px-2"
                >
                  <div>
                    <div className="font-semibold text-sm">
                      Shift #{s.id} · {s.userName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(s.openedAt).toLocaleString()}
                    </div>
                  </div>
                  <span className="text-sm text-indigo-600 font-semibold">
                    View →
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
