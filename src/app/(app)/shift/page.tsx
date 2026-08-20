import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";
import { db } from "@/db";
import { bookings, expenses, bankTransactions, shifts, users } from "@/db/schema";
import { and, eq, sql, desc, isNotNull } from "drizzle-orm";
import { getSetting, formatMoney } from "@/lib/settings";
import OpenShiftForm from "./OpenShiftForm";
import CloseShiftForm from "./CloseShiftForm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ShiftPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const currency = await getSetting("currency");
  const active = await getActiveShiftForUser(user.id);

  if (!active) {
    // Show recent shifts
    const recent = await db
      .select({
        id: shifts.id,
        openedAt: shifts.openedAt,
        closedAt: shifts.closedAt,
        openingCash: shifts.openingCash,
        closingCash: shifts.closingCash,
        userName: users.fullName,
      })
      .from(shifts)
      .innerJoin(users, eq(users.id, shifts.userId))
      .where(isNotNull(shifts.closedAt))
      .orderBy(desc(shifts.openedAt))
      .limit(10);

    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Open a new shift</h1>
          <p className="text-slate-500">
            You need to open a shift before you can work.
          </p>
        </div>
        <div className="card p-6">
          <OpenShiftForm currency={currency} />
        </div>
        {recent.length > 0 && (
          <div className="card p-6">
            <h3 className="font-bold mb-3">Recent shifts</h3>
            <div className="divide-soft text-sm">
              {recent.map((s) => (
                <div key={s.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-semibold">
                      Shift #{s.id} · {s.userName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(s.openedAt).toLocaleString()} →{" "}
                      {s.closedAt ? new Date(s.closedAt).toLocaleString() : "-"}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div>Open: {formatMoney(parseFloat(s.openingCash), currency)}</div>
                    <div>
                      Close:{" "}
                      {s.closingCash
                        ? formatMoney(parseFloat(s.closingCash), currency)
                        : "-"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Active shift — show summary
  const [totalsRow, methodRows, expensesRow, bankRow, bookingsCountRow] =
    await Promise.all([
      db
        .select({
          revenue: sql<string>`coalesce(sum(${bookings.total}), 0)`,
          seat: sql<string>`coalesce(sum(${bookings.seatCharge}), 0)`,
          orders: sql<string>`coalesce(sum(${bookings.ordersTotal}), 0)`,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.shiftId, active.id),
            eq(bookings.status, "closed"),
          ),
        ),
      db
        .select({
          method: bookings.paymentMethod,
          total: sql<string>`coalesce(sum(${bookings.total}), 0)`,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.shiftId, active.id),
            eq(bookings.status, "closed"),
          ),
        )
        .groupBy(bookings.paymentMethod),
      db
        .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
        .from(expenses)
        .where(eq(expenses.shiftId, active.id)),
      db
        .select({
          deposits: sql<string>`coalesce(sum(case when ${bankTransactions.type} = 'deposit' then ${bankTransactions.amount} else 0 end), 0)`,
          withdrawals: sql<string>`coalesce(sum(case when ${bankTransactions.type} = 'withdraw' then ${bankTransactions.amount} else 0 end), 0)`,
        })
        .from(bankTransactions)
        .where(eq(bankTransactions.shiftId, active.id)),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(bookings)
        .where(eq(bookings.shiftId, active.id)),
    ]);

  const revenue = parseFloat(totalsRow[0]?.revenue || "0");
  const seatTotal = parseFloat(totalsRow[0]?.seat || "0");
  const ordersTotal = parseFloat(totalsRow[0]?.orders || "0");
  const totalExpenses = parseFloat(expensesRow[0]?.total || "0");
  const bankDeposits = parseFloat(bankRow[0]?.deposits || "0");
  const bankWithdrawals = parseFloat(bankRow[0]?.withdrawals || "0");

  const cashTotal =
    methodRows.find((m) => m.method === "cash")?.total || "0";
  const visaTotal =
    methodRows.find((m) => m.method === "visa")?.total || "0";
  const instapayTotal =
    methodRows.find((m) => m.method === "instapay")?.total || "0";

  const openingCash = parseFloat(active.openingCash);
  const expectedCashInDrawer =
    openingCash + parseFloat(cashTotal) - totalExpenses - bankDeposits +
    bankWithdrawals;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            My Shift · #{active.id}
          </h1>
          <p className="text-slate-500">
            Opened {new Date(active.openedAt).toLocaleString()} · Opening cash{" "}
            {formatMoney(openingCash, currency)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/bookings" className="btn btn-primary">
            Bookings →
          </Link>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <StatBox label="Bookings this shift" value={`${bookingsCountRow[0]?.c || 0}`} icon="🪑" />
        <StatBox label="Seat charges" value={formatMoney(seatTotal, currency)} icon="⏱️" />
        <StatBox label="F&B sales" value={formatMoney(ordersTotal, currency)} icon="🍔" />
        <StatBox label="Total revenue" value={formatMoney(revenue, currency)} icon="💰" highlight />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="font-bold mb-4">Payment breakdown</h3>
          <div className="space-y-3">
            <Line label="💵 Cash" value={formatMoney(parseFloat(cashTotal), currency)} />
            <Line label="💳 Visa" value={formatMoney(parseFloat(visaTotal), currency)} />
            <Line label="📱 InstaPay" value={formatMoney(parseFloat(instapayTotal), currency)} />
            <div className="border-t border-slate-100 pt-3 mt-3">
              <Line label="🏦 Bank deposits" value={formatMoney(bankDeposits, currency)} />
              <Line label="🏦 Bank withdrawals" value={formatMoney(bankWithdrawals, currency)} />
              <Line label="💸 Expenses" value={formatMoney(totalExpenses, currency)} />
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h3 className="font-bold mb-4">Cash drawer</h3>
          <div className="space-y-3 text-sm">
            <Line label="Opening cash" value={formatMoney(openingCash, currency)} />
            <Line label="+ Cash sales" value={formatMoney(parseFloat(cashTotal), currency)} />
            <Line label="− Cash expenses" value={formatMoney(totalExpenses, currency)} />
            <Line label="− Deposited to bank" value={formatMoney(bankDeposits, currency)} />
            <Line label="+ Withdrawn from bank" value={formatMoney(bankWithdrawals, currency)} />
          </div>
          <div className="mt-4 p-4 rounded-xl bg-indigo-50 border border-indigo-200">
            <div className="text-xs text-indigo-700 font-semibold uppercase">
              Expected cash in drawer
            </div>
            <div className="text-2xl font-bold text-indigo-900 tabular-nums mt-1">
              {formatMoney(expectedCashInDrawer, currency)}
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="font-bold mb-4">Close shift</h3>
        <CloseShiftForm
          expectedCash={expectedCashInDrawer}
          currency={currency}
        />
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  icon: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`card p-5 ${
        highlight ? "bg-gradient-to-br from-indigo-600 to-purple-600 text-white border-0" : ""
      }`}
    >
      <div className={`text-xs uppercase font-semibold ${highlight ? "text-white/80" : "text-slate-500"}`}>
        {label}
      </div>
      <div className="flex items-end justify-between mt-2">
        <div className="text-xl font-bold tabular-nums">{value}</div>
        <div className="text-2xl">{icon}</div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
