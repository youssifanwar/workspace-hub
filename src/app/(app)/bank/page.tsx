import { db } from "@/db";
import { bankTransactions, users } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getActiveShiftForUser } from "@/lib/shift";
import { getSetting, formatMoney } from "@/lib/settings";
import BankForm from "./BankForm";

export const dynamic = "force-dynamic";

export default async function BankPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const shift = await getActiveShiftForUser(user.id);
  if (!shift) redirect("/shift");
  const currency = await getSetting("currency");

  const [totals] = await db
    .select({
      deposits: sql<string>`coalesce(sum(case when type='deposit' then amount else 0 end), 0)`,
      withdrawals: sql<string>`coalesce(sum(case when type='withdraw' then amount else 0 end), 0)`,
    })
    .from(bankTransactions);

  const rows = await db
    .select({
      id: bankTransactions.id,
      type: bankTransactions.type,
      amount: bankTransactions.amount,
      note: bankTransactions.note,
      createdAt: bankTransactions.createdAt,
      userName: users.fullName,
    })
    .from(bankTransactions)
    .innerJoin(users, eq(users.id, bankTransactions.userId))
    .orderBy(desc(bankTransactions.createdAt))
    .limit(50);

  const deposits = parseFloat(totals?.deposits || "0");
  const withdrawals = parseFloat(totals?.withdrawals || "0");
  const balance = deposits - withdrawals;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Bank</h1>
        <p className="text-slate-500">
          Track cash deposited to the bank and withdrawals from bank to cash.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="kpi bg-gradient-to-br from-emerald-500 to-teal-500">
          <div className="text-xs uppercase text-white/80 font-semibold">
            Total deposits
          </div>
          <div className="text-2xl font-bold mt-2 tabular-nums">
            {formatMoney(deposits, currency)}
          </div>
        </div>
        <div className="kpi bg-gradient-to-br from-amber-500 to-orange-500">
          <div className="text-xs uppercase text-white/80 font-semibold">
            Total withdrawals
          </div>
          <div className="text-2xl font-bold mt-2 tabular-nums">
            {formatMoney(withdrawals, currency)}
          </div>
        </div>
        <div className="kpi bg-gradient-to-br from-indigo-600 to-purple-600">
          <div className="text-xs uppercase text-white/80 font-semibold">
            Net bank balance
          </div>
          <div className="text-2xl font-bold mt-2 tabular-nums">
            {formatMoney(balance, currency)}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card p-5 lg:col-span-1">
          <h3 className="font-bold mb-3">New transaction</h3>
          <BankForm currency={currency} />
        </div>
        <div className="card p-5 lg:col-span-2">
          <h3 className="font-bold mb-3">Recent transactions</h3>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">
              No transactions yet
            </p>
          ) : (
            <div className="divide-soft">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="py-3 flex items-center gap-3"
                >
                  <div
                    className={`w-10 h-10 rounded-xl grid place-items-center text-lg ${
                      r.type === "deposit"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {r.type === "deposit" ? "⬆️" : "⬇️"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold capitalize">
                      {r.type} · {r.userName}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {r.note || "No note"} ·{" "}
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div
                    className={`font-bold tabular-nums ${
                      r.type === "deposit" ? "text-emerald-600" : "text-amber-600"
                    }`}
                  >
                    {r.type === "deposit" ? "+" : "-"}
                    {formatMoney(parseFloat(r.amount), currency)}
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
