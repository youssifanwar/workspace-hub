import { db } from "@/db";
import { expenses, users } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getActiveShiftForUser } from "@/lib/shift";
import { getSetting, formatMoney } from "@/lib/settings";
import ExpenseForm from "./ExpenseForm";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const shift = await getActiveShiftForUser(user.id);
  if (!shift) redirect("/shift");
  const currency = await getSetting("currency");

  const [totals] = await db
    .select({ total: sql<string>`coalesce(sum(amount), 0)` })
    .from(expenses);

  const rows = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      category: expenses.category,
      note: expenses.note,
      createdAt: expenses.createdAt,
      userName: users.fullName,
    })
    .from(expenses)
    .innerJoin(users, eq(users.id, expenses.userId))
    .orderBy(desc(expenses.createdAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Expenses</h1>
          <p className="text-slate-500">
            Record purchases, utilities, salaries, or any operational cost.
          </p>
        </div>
        <div className="kpi bg-gradient-to-br from-rose-500 to-red-500 min-w-[220px]">
          <div className="text-xs uppercase text-white/80 font-semibold">
            All-time expenses
          </div>
          <div className="text-2xl font-bold mt-2 tabular-nums">
            {formatMoney(parseFloat(totals?.total || "0"), currency)}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card p-5 lg:col-span-1">
          <h3 className="font-bold mb-3">New expense</h3>
          <ExpenseForm currency={currency} />
        </div>
        <div className="card p-5 lg:col-span-2">
          <h3 className="font-bold mb-3">Recent expenses</h3>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No expenses yet</p>
          ) : (
            <div className="divide-soft">
              {rows.map((r) => (
                <div key={r.id} className="py-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 grid place-items-center">
                    💸
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">
                      {r.category}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {r.note || "No note"} · {r.userName} ·{" "}
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="font-bold text-rose-600 tabular-nums">
                    -{formatMoney(parseFloat(r.amount), currency)}
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
