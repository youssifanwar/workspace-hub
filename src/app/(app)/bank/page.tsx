import { PageBar, StatStrip, Panel } from "../_components/ui";
import { desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { bankTransactions, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney, getSetting } from "@/lib/settings";
import { getActiveShiftForUser } from "@/lib/shift";
import { getExpectedDrawerCash } from "@/lib/drawer-cash";

import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";
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

export default async function BankPage() {
  const f = makeFmt(await getLang());
  const tx = f.t;
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const shift = await getActiveShiftForUser(user.id);

  if (!shift) {
    redirect("/shift");
  }

  const currency = await getSetting("currency");
  const expectedCash = await getExpectedDrawerCash(db, shift.id, Number(shift.openingCash) || 0).catch(() => null);

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
    <div>
      <PageBar
        crumb={tx("Finance")}
        title={tx("Bank")}
        description={tx("Track cash deposited to the bank and withdrawals from bank to cash.")}
      />

      <StatStrip
        items={[
          { label: tx("Net bank balance"), value: f.money(balance), tone: "brand" },
          { label: tx("Total deposits"), value: f.money(deposits), tone: "green" },
          { label: tx("Total withdrawals"), value: f.money(withdrawals), tone: "amber" },
        ]}
      />

      <div className="v2-split rev">
        <div className="v2-sticky">
          <Panel title={tx("New transaction")}>
            <BankForm currency={currency} expectedCash={expectedCash} />
          </Panel>
        </div>

        <Panel title={tx("Recent transactions")} meta={tx("Latest 50")} flush>
          {rows.length === 0 ? (
            <div className="v2-empty">{tx("No transactions yet")}</div>
          ) : (
            <div className="x-table-wrap">
              <table className="v2-tbl">
                <thead>
                  <tr>
                    <th>{tx("Type")}</th>
                    <th>{tx("Note")}</th>
                    <th>{tx("Staff")}</th>
                    <th>{tx("Date")}</th>
                    <th className="num">{tx("Amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const amount = safeNumber(row.amount);
                    const isDeposit = row.type === "deposit";
                    return (
                      <tr key={row.id}>
                        <td>
                          <span className={`v2-tag ${isDeposit ? "green" : "amber"}`}>
                            {isDeposit ? tx("Deposit") : tx("Withdraw")}
                          </span>
                        </td>
                        <td>{row.note?.trim() || <span className="muted">{tx("No note")}</span>}</td>
                        <td className="muted">{row.userName || tx("Unknown user")}</td>
                        <td className="muted">{f.dateTime(row.createdAt)}</td>
                        <td className="num" style={{ color: isDeposit ? "#047857" : "#b45309" }}>
                          {isDeposit ? "+" : "-"}
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
