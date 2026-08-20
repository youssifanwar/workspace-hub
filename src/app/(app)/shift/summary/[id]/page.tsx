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
  products,
} from "@/db/schema";
import { and, eq, sql, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getSetting, formatMoney } from "@/lib/settings";
import Link from "next/link";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

export default async function ShiftSummary({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const shiftId = Number(id);
  if (!shiftId) notFound();

  const currency = await getSetting("currency");

  const [shiftRow] = await db
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
    .limit(1);
  if (!shiftRow) notFound();

  const [totalsRow, methodRows, expensesRows, bankRows, allBookings, topProducts] =
    await Promise.all([
      db
        .select({
          revenue: sql<string>`coalesce(sum(${bookings.total}), 0)`,
          seat: sql<string>`coalesce(sum(${bookings.seatCharge}), 0)`,
          orders: sql<string>`coalesce(sum(${bookings.ordersTotal}), 0)`,
        })
        .from(bookings)
        .where(
          and(eq(bookings.shiftId, shiftId), eq(bookings.status, "closed")),
        ),
      db
        .select({
          method: bookings.paymentMethod,
          total: sql<string>`coalesce(sum(${bookings.total}), 0)`,
        })
        .from(bookings)
        .where(
          and(eq(bookings.shiftId, shiftId), eq(bookings.status, "closed")),
        )
        .groupBy(bookings.paymentMethod),
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
        .innerJoin(customers, eq(customers.id, bookings.customerId))
        .innerJoin(desks, eq(desks.id, bookings.deskId))
        .where(eq(bookings.shiftId, shiftId))
        .orderBy(desc(bookings.checkedInAt)),
      db
        .select({
          name: bookingItems.nameSnapshot,
          qty: sql<number>`sum(${bookingItems.quantity})::int`,
          revenue: sql<string>`coalesce(sum(${bookingItems.quantity} * ${bookingItems.unitPrice}), 0)`,
        })
        .from(bookingItems)
        .innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
        .where(eq(bookings.shiftId, shiftId))
        .groupBy(bookingItems.nameSnapshot)
        .orderBy(desc(sql`sum(${bookingItems.quantity})`))
        .limit(6),
    ]);

  // suppress unused import warning
  void products;

  const revenue = parseFloat(totalsRow[0]?.revenue || "0");
  const seatTotal = parseFloat(totalsRow[0]?.seat || "0");
  const ordersTotal = parseFloat(totalsRow[0]?.orders || "0");
  const expensesTotal = expensesRows.reduce(
    (s, e) => s + parseFloat(e.amount),
    0,
  );
  const bankDeposits = bankRows
    .filter((b) => b.type === "deposit")
    .reduce((s, b) => s + parseFloat(b.amount), 0);
  const bankWithdrawals = bankRows
    .filter((b) => b.type === "withdraw")
    .reduce((s, b) => s + parseFloat(b.amount), 0);

  const cashTotal = parseFloat(
    methodRows.find((m) => m.method === "cash")?.total || "0",
  );
  const visaTotal = parseFloat(
    methodRows.find((m) => m.method === "visa")?.total || "0",
  );
  const instapayTotal = parseFloat(
    methodRows.find((m) => m.method === "instapay")?.total || "0",
  );

  const openingCash = parseFloat(shiftRow.openingCash);
  const closingCash = shiftRow.closingCash ? parseFloat(shiftRow.closingCash) : null;
  const expectedCash =
    openingCash + cashTotal - expensesTotal - bankDeposits + bankWithdrawals;
  const diff = closingCash !== null ? closingCash - expectedCash : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3 no-print">
        <div>
          <h1 className="text-3xl font-bold">Shift #{shiftRow.id} Summary</h1>
          <p className="text-slate-500 text-sm">
            {shiftRow.userName} · {new Date(shiftRow.openedAt).toLocaleString()}
            {shiftRow.closedAt
              ? ` → ${new Date(shiftRow.closedAt).toLocaleString()}`
              : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <PrintButton />
          <Link href="/dashboard" className="btn btn-primary">
            Dashboard →
          </Link>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <Kpi label="Total revenue" value={formatMoney(revenue, currency)} grad="from-indigo-500 to-purple-500" />
        <Kpi label="Seat charges" value={formatMoney(seatTotal, currency)} grad="from-cyan-500 to-blue-500" />
        <Kpi label="F&B sales" value={formatMoney(ordersTotal, currency)} grad="from-orange-500 to-pink-500" />
        <Kpi label="Expenses" value={formatMoney(expensesTotal, currency)} grad="from-rose-500 to-red-500" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="font-bold mb-4">Payment breakdown</h3>
          <Row label="💵 Cash" value={formatMoney(cashTotal, currency)} />
          <Row label="💳 Visa" value={formatMoney(visaTotal, currency)} />
          <Row label="📱 InstaPay" value={formatMoney(instapayTotal, currency)} />
          <div className="h-px bg-slate-100 my-3" />
          <Row label="🏦 Bank deposits" value={formatMoney(bankDeposits, currency)} />
          <Row label="🏦 Bank withdrawals" value={formatMoney(bankWithdrawals, currency)} />
        </div>
        <div className="card p-6">
          <h3 className="font-bold mb-4">Cash drawer</h3>
          <Row label="Opening cash" value={formatMoney(openingCash, currency)} />
          <Row label="+ Cash sales" value={formatMoney(cashTotal, currency)} />
          <Row label="− Cash expenses" value={formatMoney(expensesTotal, currency)} />
          <Row label="− Deposited" value={formatMoney(bankDeposits, currency)} />
          <Row label="+ Withdrawn" value={formatMoney(bankWithdrawals, currency)} />
          <div className="h-px bg-slate-100 my-3" />
          <Row label="Expected cash" value={formatMoney(expectedCash, currency)} />
          {closingCash !== null && (
            <>
              <Row label="Counted cash" value={formatMoney(closingCash, currency)} />
              <div
                className={`mt-3 p-3 rounded-xl text-sm font-semibold ${
                  Math.abs(diff) < 0.01
                    ? "bg-emerald-50 text-emerald-800"
                    : diff > 0
                    ? "bg-blue-50 text-blue-800"
                    : "bg-red-50 text-red-800"
                }`}
              >
                Difference: {diff >= 0 ? "+" : ""}
                {diff.toFixed(2)} {currency}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card p-6">
        <h3 className="font-bold mb-4">Top selling items</h3>
        {topProducts.length === 0 ? (
          <p className="text-sm text-slate-400">No items sold in this shift</p>
        ) : (
          <div className="grid md:grid-cols-3 gap-3">
            {topProducts.map((p, i) => (
              <div
                key={p.name}
                className="p-4 rounded-xl border border-slate-200 flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 grid place-items-center font-bold">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{p.name}</div>
                  <div className="text-xs text-slate-500">
                    {p.qty} sold ·{" "}
                    {formatMoney(parseFloat(p.revenue), currency)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-6">
        <h3 className="font-bold mb-4">Bookings ({allBookings.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 uppercase">
                <th className="py-2">#</th>
                <th>Customer</th>
                <th>Desk / Room</th>
                <th>Duration</th>
                <th>Payment</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {allBookings.map((b) => {
                const dur =
                  b.checkedOutAt && b.checkedInAt
                    ? Math.max(
                        0,
                        (new Date(b.checkedOutAt).getTime() -
                          new Date(b.checkedInAt).getTime()) /
                          3_600_000,
                      ).toFixed(2)
                    : "-";
                return (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="py-2">{b.id}</td>
                    <td className="font-semibold">{b.customerName}</td>
                    <td>{b.deskName}</td>
                    <td>{dur} h</td>
                    <td className="capitalize">{b.paymentMethod || "-"}</td>
                    <td className="text-right font-bold">
                      {formatMoney(parseFloat(b.total || "0"), currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="font-bold mb-4">Expenses ({expensesRows.length})</h3>
          {expensesRows.length === 0 ? (
            <p className="text-sm text-slate-400">No expenses</p>
          ) : (
            <div className="divide-soft">
              {expensesRows.map((e) => (
                <div key={e.id} className="py-2 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm">{e.category}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {e.note}
                    </div>
                  </div>
                  <div className="font-bold text-red-600">
                    -{formatMoney(parseFloat(e.amount), currency)}
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
            <p className="text-sm text-slate-400">No transactions</p>
          ) : (
            <div className="divide-soft">
              {bankRows.map((b) => (
                <div key={b.id} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-sm capitalize">
                      {b.type}
                    </div>
                    <div className="text-xs text-slate-500">{b.note}</div>
                  </div>
                  <div
                    className={`font-bold ${
                      b.type === "deposit" ? "text-emerald-600" : "text-amber-600"
                    }`}
                  >
                    {b.type === "deposit" ? "+" : "-"}
                    {formatMoney(parseFloat(b.amount), currency)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, grad }: { label: string; value: string; grad: string }) {
  return (
    <div className={`kpi bg-gradient-to-br ${grad}`}>
      <div className="text-xs uppercase font-semibold text-white/80">{label}</div>
      <div className="text-2xl font-bold mt-2 tabular-nums">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
