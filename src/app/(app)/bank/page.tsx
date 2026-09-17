import { desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { bankTransactions, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney, getSetting } from "@/lib/settings";
import { getActiveShiftForUser } from "@/lib/shift";

import BankForm from "./BankForm";

export const dynamic = "force-dynamic";

function safeNumber(
  value: string | number | null | undefined,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(value ?? "0");

  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "-";
  }

  return value.toLocaleString("en-EG");
}

export default async function BankPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const shift = await getActiveShiftForUser(user.id);

  if (!shift) {
    redirect("/shift");
  }

  const currency = await getSetting("currency");

  const [totalsRow] = await db
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
    .innerJoin(
      users,
      eq(users.id, bankTransactions.userId),
    )
    .orderBy(desc(bankTransactions.createdAt))
    .limit(50);

  const deposits = safeNumber(totalsRow?.deposits);
  const withdrawals = safeNumber(totalsRow?.withdrawals);
  const balance = deposits - withdrawals;

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900">
          Bank
        </h1>

        <p className="text-slate-500">
          Track cash deposited to the bank and withdrawals from bank
          to cash.
        </p>
      </div>

      {/* SUMMARY */}
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

      {/* MAIN CONTENT */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* NEW TRANSACTION */}
        <section className="card p-5 lg:col-span-1">
          <h2 className="font-bold mb-3">
            New transaction
          </h2>

          <BankForm currency={currency} />
        </section>

        {/* RECENT TRANSACTIONS */}
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold">
              Recent transactions
            </h2>

            <span className="text-xs text-slate-400">
              Latest 50
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-8">
              No transactions yet
            </div>
          ) : (
            <div className="divide-soft">
              {rows.map((row) => {
                const amount = safeNumber(row.amount);
                const isDeposit = row.type === "deposit";

                return (
                  <div
                    key={row.id}
                    className="py-3 flex items-center gap-3"
                  >
                    {/* TYPE ICON */}
                    <div
                      className={`w-10 h-10 rounded-xl grid place-items-center text-lg shrink-0 ${
                        isDeposit
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                      aria-hidden="true"
                    >
                      {isDeposit ? "⬆️" : "⬇️"}
                    </div>

                    {/* DETAILS */}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800">
                        {isDeposit ? "Deposit" : "Withdraw"}
                        {" · "}
                        {row.userName || "Unknown user"}
                      </div>

                      <div className="text-xs text-slate-500 truncate">
                        {row.note?.trim() || "No note"}
                        {" · "}
                        {formatDateTime(row.createdAt)}
                      </div>
                    </div>

                    {/* AMOUNT */}
                    <div
                      className={`font-bold tabular-nums shrink-0 ${
                        isDeposit
                          ? "text-emerald-600"
                          : "text-amber-600"
                      }`}
                    >
                      {isDeposit ? "+" : "-"}
                      {formatMoney(amount, currency)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}