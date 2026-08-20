import { db } from "@/db";
import {
  bookings,
  bookingItems,
  expenses,
  bankTransactions,
  customers,
  desks,
} from "@/db/schema";
import { sql, eq, and, gte, isNull, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getSetting, formatMoney } from "@/lib/settings";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const currency = await getSetting("currency");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    todayRevenueRow,
    todayOrdersRow,
    todaySeatRow,
    todayExpensesRow,
    todayBankRow,
    customersCount,
    activeBookingsRows,
    recentBookings,
    paymentBreakdown,
  ] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${bookings.total}), 0)` })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "closed"),
          gte(bookings.checkedInAt, startOfDay),
        ),
      ),
    db
      .select({ total: sql<string>`coalesce(sum(${bookings.ordersTotal}), 0)` })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "closed"),
          gte(bookings.checkedInAt, startOfDay),
        ),
      ),
    db
      .select({ total: sql<string>`coalesce(sum(${bookings.seatCharge}), 0)` })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "closed"),
          gte(bookings.checkedInAt, startOfDay),
        ),
      ),
    db
      .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
      .from(expenses)
      .where(gte(expenses.createdAt, startOfDay)),
    db
      .select({
        deposits: sql<string>`coalesce(sum(case when ${bankTransactions.type} = 'deposit' then ${bankTransactions.amount} else 0 end), 0)`,
        withdrawals: sql<string>`coalesce(sum(case when ${bankTransactions.type} = 'withdraw' then ${bankTransactions.amount} else 0 end), 0)`,
      })
      .from(bankTransactions)
      .where(gte(bankTransactions.createdAt, startOfDay)),
    db.select({ c: sql<number>`count(*)::int` }).from(customers),
    db
      .select({
        id: bookings.id,
        customerName: customers.name,
        deskName: desks.name,
        checkedInAt: bookings.checkedInAt,
        deskType: desks.type,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .innerJoin(desks, eq(desks.id, bookings.deskId))
      .where(eq(bookings.status, "active")),
    db
      .select({
        id: bookings.id,
        customerName: customers.name,
        deskName: desks.name,
        total: bookings.total,
        paymentMethod: bookings.paymentMethod,
        checkedOutAt: bookings.checkedOutAt,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .innerJoin(desks, eq(desks.id, bookings.deskId))
      .where(eq(bookings.status, "closed"))
      .orderBy(desc(bookings.checkedOutAt))
      .limit(6),
    db
      .select({
        method: bookings.paymentMethod,
        total: sql<string>`coalesce(sum(${bookings.total}), 0)`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "closed"),
          gte(bookings.checkedInAt, startOfDay),
        ),
      )
      .groupBy(bookings.paymentMethod),
  ]);

  const todayRevenue = parseFloat(todayRevenueRow[0]?.total || "0");
  const todayOrders = parseFloat(todayOrdersRow[0]?.total || "0");
  const todaySeat = parseFloat(todaySeatRow[0]?.total || "0");
  const todayExpenses = parseFloat(todayExpensesRow[0]?.total || "0");
  const bankDeposits = parseFloat(todayBankRow[0]?.deposits || "0");
  const bankWithdrawals = parseFloat(todayBankRow[0]?.withdrawals || "0");
  const netRevenue = todayRevenue - todayExpenses;

  const activeCount = activeBookingsRows.length;
  const activeDesksCount = activeBookingsRows.filter(
    (b) => b.deskType === "desk",
  ).length;
  const activeRoomsCount = activeBookingsRows.filter(
    (b) => b.deskType === "meeting_room",
  ).length;

  const _ = isNull; // keep import used
  void _;

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
      label: "Active Bookings",
      value: `${activeCount}`,
      sub: `${activeDesksCount} desks · ${activeRoomsCount} rooms`,
      icon: "🪑",
      grad: "from-fuchsia-500 to-pink-500",
    },
    {
      label: "Customers",
      value: `${customersCount[0]?.c || 0}`,
      icon: "👥",
      grad: "from-slate-700 to-slate-500",
    },
    {
      label: "Bank Δ Today",
      value: formatMoney(bankDeposits - bankWithdrawals, currency),
      sub: `+${formatMoney(bankDeposits, currency)} / -${formatMoney(bankWithdrawals, currency)}`,
      icon: "🏦",
      grad: "from-amber-500 to-orange-500",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500">
            Welcome back, {user.fullName.split(" ")[0]} 👋
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/bookings" className="btn btn-primary">
            + New Booking
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className={`kpi bg-gradient-to-br ${k.grad}`}>
            <div className="flex items-start justify-between relative z-10">
              <div>
                <div className="text-xs uppercase tracking-wider text-white/80 font-semibold">
                  {k.label}
                </div>
                <div className="text-2xl font-bold mt-2 tabular-nums">
                  {k.value}
                </div>
                {k.sub && (
                  <div className="text-[11px] mt-1 text-white/85">{k.sub}</div>
                )}
              </div>
              <div className="text-3xl relative z-10">{k.icon}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Currently Seated</h2>
            <Link href="/bookings" className="text-sm text-indigo-600 font-semibold">
              View all →
            </Link>
          </div>
          {activeBookingsRows.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <div className="text-4xl mb-2">🪑</div>
              No active bookings right now
            </div>
          ) : (
            <div className="divide-soft">
              {activeBookingsRows.map((b) => (
                <Link
                  key={b.id}
                  href={`/bookings/${b.id}`}
                  className="flex items-center gap-3 py-3 hover:bg-slate-50 rounded-lg px-2 -mx-2"
                >
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 grid place-items-center font-bold">
                    {b.customerName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 truncate">
                      {b.customerName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {b.deskName} · started{" "}
                      {new Date(b.checkedInAt).toLocaleTimeString()}
                    </div>
                  </div>
                  <span
                    className={`badge ${
                      b.deskType === "meeting_room"
                        ? "badge-amber"
                        : "badge-blue"
                    }`}
                  >
                    {b.deskType === "meeting_room" ? "Room" : "Desk"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-bold mb-4">Payments Today</h2>
          {paymentBreakdown.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              No payments yet
            </div>
          ) : (
            <div className="space-y-3">
              {paymentBreakdown.map((p) => {
                const label =
                  p.method === "cash"
                    ? "💵 Cash"
                    : p.method === "visa"
                    ? "💳 Visa"
                    : "📱 InstaPay";
                return (
                  <div
                    key={p.method}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50"
                  >
                    <div className="text-sm font-semibold">{label}</div>
                    <div className="font-bold text-slate-800 tabular-nums">
                      {formatMoney(parseFloat(p.total), currency)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-bold mb-4">Recent Closed Bookings</h2>
        {recentBookings.length === 0 ? (
          <div className="text-center py-8 text-slate-400">No closed bookings yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase">
                  <th className="py-2 px-2">Customer</th>
                  <th className="py-2 px-2">Desk / Room</th>
                  <th className="py-2 px-2">Payment</th>
                  <th className="py-2 px-2">Closed</th>
                  <th className="py-2 px-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {recentBookings.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="py-3 px-2 font-semibold">{b.customerName}</td>
                    <td className="py-3 px-2">{b.deskName}</td>
                    <td className="py-3 px-2 capitalize">{b.paymentMethod}</td>
                    <td className="py-3 px-2 text-slate-500">
                      {b.checkedOutAt
                        ? new Date(b.checkedOutAt).toLocaleString()
                        : "-"}
                    </td>
                    <td className="py-3 px-2 text-right font-bold tabular-nums">
                      {formatMoney(parseFloat(b.total || "0"), currency)}
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
