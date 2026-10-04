import { desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { expenses, manualIncomes, users } from "@/db/schema";
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

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const shift = await getActiveShiftForUser(user.id);

  if (!shift) {
    redirect("/shift");
  }

  const currency = await getSetting("currency");
  const { tab } = await searchParams;
  const isIncome = tab === "income";

  const [
    totalsRow,
    rows,
    incomeTotalsRow,
    incomeRows,
    expenseCategoryRows,
    incomeCategoryRows,
  ] = await Promise.all([
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
    db
      .select({
        total: sql<string>`coalesce(sum(${manualIncomes.amount}), 0)`,
      })
      .from(manualIncomes),
    db
      .select({
        id: manualIncomes.id,
        amount: manualIncomes.amount,
        category: manualIncomes.category,
        note: manualIncomes.note,
        createdAt: manualIncomes.createdAt,
        userName: users.fullName,
      })
      .from(manualIncomes)
      .innerJoin(users, eq(users.id, manualIncomes.userId))
      .orderBy(desc(manualIncomes.createdAt))
      .limit(50),
    db.selectDistinct({ category: expenses.category }).from(expenses).limit(100),
    db
      .selectDistinct({ category: manualIncomes.category })
      .from(manualIncomes)
      .limit(100),
  ]);
  const incomeTotal = safeNumber(incomeTotalsRow[0]?.total);
  const expenseCategories = expenseCategoryRows.map((r) => r.category);
  const incomeCategories = incomeCategoryRows.map((r) => r.category);
  const activeRows = isIncome ? incomeRows : rows;

  const totalExpenses = safeNumber(
    totalsRow[0]?.total,
  );

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Expenses &amp; Income
          </h1>
          <p className="text-slate-500">
            Record money going out (expenses) and extra money coming in
            (income). Session, café and package sales are counted
            automatically — only add income here if it is not recorded
            anywhere else.
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <div className="kpi bg-gradient-to-br from-emerald-500 to-green-600 min-w-[200px]">
            <div className="text-xs uppercase text-white/80 font-semibold">
              Manual income (all-time)
            </div>
            <div className="text-2xl font-bold mt-2 tabular-nums">
              {formatMoney(incomeTotal, currency)}
            </div>
          </div>
          <div className="kpi bg-gradient-to-br from-rose-500 to-red-500 min-w-[200px]">
            <div className="text-xs uppercase text-white/80 font-semibold">
              All-time expenses
            </div>
            <div className="text-2xl font-bold mt-2 tabular-nums">
              {formatMoney(totalExpenses, currency)}
            </div>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div className="flex gap-2">
        <a
          href="/expenses"
          className={`btn ${!isIncome ? "btn-primary" : "btn-ghost"}`}
        >
          💸 Expenses
        </a>
        <a
          href="/expenses?tab=income"
          className={`btn ${isIncome ? "btn-primary" : "btn-ghost"}`}
        >
          💰 Income
        </a>
      </div>

      {/* CONTENT */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* NEW ENTRY */}
        <section className="card p-5 lg:col-span-1">
          <h2 className="font-bold mb-3">
            {isIncome ? "New income" : "New expense"}
          </h2>
          <ExpenseForm
            key={isIncome ? "income" : "expense"}
            currency={currency}
            kind={isIncome ? "income" : "expense"}
            categories={isIncome ? incomeCategories : expenseCategories}
          />
        </section>

        {/* RECENT */}
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold">
              {isIncome ? "Recent income" : "Recent expenses"}
            </h2>
            <span className="text-xs text-slate-400">Latest 50</span>
          </div>
          {activeRows.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-8">
              {isIncome ? "No income entries yet" : "No expenses yet"}
            </div>
          ) : (
            <div className="divide-soft">
              {activeRows.map((row) => {
                const amount = safeNumber(row.amount);
                return (
                  <div key={row.id} className="py-3 flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${
                        isIncome
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-rose-100 text-rose-700"
                      }`}
                      aria-hidden="true"
                    >
                      {isIncome ? "💰" : "💸"}
                    </div>
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
                    <div
                      className={`font-bold tabular-nums shrink-0 ${
                        isIncome ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {isIncome ? "+" : "-"}
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
