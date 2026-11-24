import { PageBar, StatStrip, Panel } from "../_components/ui";
import { desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { expenses, manualIncomes, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney, getSetting } from "@/lib/settings";
import { getActiveShiftForUser } from "@/lib/shift";

import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";
import ExpenseForm from "./ExpenseForm";
import { activeTimeZone, loadTimezone } from "@/lib/timezone";

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

  return value.toLocaleString("en-EG", { timeZone: activeTimeZone() });
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const f = makeFmt(await getLang());
  const tx = f.t;
  const user = await getCurrentUser();
  await loadTimezone();

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
    shiftExpenseRow,
    shiftIncomeRow,
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
        paymentMethod: expenses.paymentMethod,
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
        paymentMethod: manualIncomes.paymentMethod,
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
    db
      .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
      .from(expenses)
      .where(eq(expenses.shiftId, shift.id)),
    db
      .select({ total: sql<string>`coalesce(sum(${manualIncomes.amount}), 0)` })
      .from(manualIncomes)
      .where(eq(manualIncomes.shiftId, shift.id)),
  ]);
  const incomeTotal = safeNumber(incomeTotalsRow[0]?.total);
  const shiftExpenseTotal = safeNumber(shiftExpenseRow[0]?.total);
  const shiftIncomeTotal = safeNumber(shiftIncomeRow[0]?.total);
  const expenseCategories = expenseCategoryRows.map((r) => r.category);
  const incomeCategories = incomeCategoryRows.map((r) => r.category);
  const activeRows = isIncome ? incomeRows : rows;

  const totalExpenses = safeNumber(
    totalsRow[0]?.total,
  );

  return (
    <div>
      <PageBar
        crumb={tx("Finance")}
        title={f.en ? "Expenses & Income" : "المصروفات والإيرادات"}
        description={tx("Record money going out (expenses) and extra money coming in (income). Session, café and package sales are counted automatically — only add income here if it is not recorded anywhere else.")}
        actions={
          <div className="x-tabs">
            <a href="/expenses" className={`x-tab ${!isIncome ? "active" : ""}`}>
              {tx("💸 Expenses")}
            </a>
            <a href="/expenses?tab=income" className={`x-tab ${isIncome ? "active" : ""}`}>
              {tx("💰 Income")}
            </a>
          </div>
        }
      />

      <StatStrip
        items={[
          { label: tx("This shift · income"), value: f.money(shiftIncomeTotal), tone: "green" },
          { label: tx("This shift · expenses"), value: f.money(shiftExpenseTotal), tone: "red" },
          { label: tx("Manual income (all-time)"), value: f.money(incomeTotal), tone: "slate" },
          { label: tx("All-time expenses"), value: f.money(totalExpenses), tone: "slate" },
        ]}
      />

      <div className="v2-split rev">
        <div className="v2-sticky">
          <Panel title={isIncome ? tx("New income") : tx("New expense")}>
            <ExpenseForm
              key={isIncome ? "income" : "expense"}
              currency={currency}
              kind={isIncome ? "income" : "expense"}
              categories={isIncome ? incomeCategories : expenseCategories}
            />
          </Panel>
        </div>

        <Panel
          title={isIncome ? tx("Recent income") : tx("Recent expenses")}
          meta={tx("Latest 50")}
          flush
        >
          {activeRows.length === 0 ? (
            <div className="v2-empty">
              {isIncome ? tx("No income entries yet") : tx("No expenses yet")}
            </div>
          ) : (
            <div className="x-table-wrap">
              <table className="v2-tbl">
                <thead>
                  <tr>
                    <th>{tx("Category")}</th>
                    <th>{tx("Note")}</th>
                    <th>{tx("Paid by")}</th>
                    <th>{tx("Staff")}</th>
                    <th>{tx("Date")}</th>
                    <th className="num">{tx("Amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRows.map((row) => {
                    const amount = safeNumber(row.amount);
                    return (
                      <tr key={row.id}>
                        <td>
                          <span className={`v2-tag ${isIncome ? "green" : "red"}`}>
                            {tx(row.category || "General")}
                          </span>
                        </td>
                        <td>{row.note?.trim() || <span className="muted">{tx("No note")}</span>}</td>
                        <td className="muted">{f.pay(String(row.paymentMethod ?? "cash"))}</td>
                        <td className="muted">{row.userName || tx("Unknown user")}</td>
                        <td className="muted">{f.dateTime(row.createdAt)}</td>
                        <td className="num" style={{ color: isIncome ? "#047857" : "#b91c1c" }}>
                          {isIncome ? "+" : "-"}
                          {f.money(amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
