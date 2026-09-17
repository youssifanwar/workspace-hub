import { desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { expenses, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney, getSetting } from "@/lib/settings";
import { getActiveShiftForUser } from "@/lib/shift";

import ExpenseForm from "./ExpenseForm";

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
  if (!(value instanceof Date)) {
    return "-";
  }

  if (Number.isNaN(value.getTime())) {
    return "-";
  }

  return value.toLocaleString("en-EG");
}

export default async function ExpensesPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const shift = await getActiveShiftForUser(user.id);

  if (!shift) {
    redirect("/shift");
  }

  const currency = await getSetting("currency");

  const [totalsRow, rows] = await Promise.all([
    db
      .select({
        total: sql<string>`
          coalesce(sum(${expenses.amount}), 0)
        `,
      })
      .from(expenses),

    db
      .select({
        id: expenses.id,
        amount: expenses.amount,
        category: expenses.category,
        note: expenses.note,
        createdAt: expenses.createdAt,
        userName: users.fullName,
      })
      .from(expenses)
      .innerJoin(
        users,
        eq(users.id, expenses.userId),
      )
      .orderBy(desc(expenses.createdAt))
      .limit(50),
  ]);

  const totalExpenses = safeNumber(
    totalsRow[0]?.total,
  );

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Expenses
          </h1>

          <p className="text-slate-500">
            Record purchases, utilities, salaries, or any operational
            cost.
          </p>
        </div>

        <div className="kpi bg-gradient-to-br from-rose-500 to-red-500 min-w-[220px]">
          <div className="text-xs uppercase text-white/80 font-semibold">
            All-time expenses
          </div>

          <div className="text-2xl font-bold mt-2 tabular-nums">
            {formatMoney(
              totalExpenses,
              currency,
            )}
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* NEW EXPENSE */}
        <section className="card p-5 lg:col-span-1">
          <h2 className="font-bold mb-3">
            New expense
          </h2>

          <ExpenseForm currency={currency} />
        </section>

        {/* RECENT EXPENSES */}
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold">
              Recent expenses
            </h2>

            <span className="text-xs text-slate-400">
              Latest 50
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-8">
              No expenses yet
            </div>
          ) : (
            <div className="divide-soft">
              {rows.map((row) => {
                const amount = safeNumber(
                  row.amount,
                );

                return (
                  <div
                    key={row.id}
                    className="py-3 flex items-center gap-3"
                  >
                    {/* ICON */}
                    <div
                      className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 grid place-items-center shrink-0"
                      aria-hidden="true"
                    >
                      💸
                    </div>

                    {/* DETAILS */}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800">
                        {row.category || "General"}
                      </div>

                      <div className="text-xs text-slate-500 truncate">
                        {row.note?.trim() || "No note"}
                        {" · "}
                        {row.userName || "Unknown user"}
                        {" · "}
                        {formatDateTime(row.createdAt)}
                      </div>
                    </div>

                    {/* AMOUNT */}
                    <div className="font-bold text-rose-600 tabular-nums shrink-0">
                      -{formatMoney(
                        amount,
                        currency,
                      )}
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