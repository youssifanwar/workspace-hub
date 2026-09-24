import { redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";
import { db } from "@/db";
import {
  bankTransactions,
  bookings,
  expenses,
  shifts,
  users,
} from "@/db/schema";
import { formatMoney, getSetting } from "@/lib/settings";

import OpenShiftForm from "./OpenShiftForm";
import CloseShiftForm from "./CloseShiftForm";

export const dynamic = "force-dynamic";

function safeNumber(value: unknown, fallback = 0): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number(value)
      : NaN;

  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeMoney(value: unknown): number {
  const parsed = safeNumber(value, 0);

  if (parsed < 0) {
    return 0;
  }

  return Math.round(parsed * 100) / 100;
}

function formatDate(value: Date | string | null): string {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("en-EG", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export default async function ShiftPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const [currency, active] = await Promise.all([
    getSetting("currency"),
    getActiveShiftForUser(user.id),
  ]);

  if (!active) {
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
          <h1 className="text-3xl font-bold text-slate-900">
            Open a new shift
          </h1>

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
              {recent.map((shift) => {
                const openingCash = safeMoney(shift.openingCash);
                const closingCash =
                  shift.closingCash !== null
                    ? safeMoney(shift.closingCash)
                    : null;

                return (
                  <div
                    key={shift.id}
                    className="py-3 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold">
                        Shift #{shift.id} ·{" "}
                        {shift.userName || "Unknown user"}
                      </div>

                      <div className="text-xs text-slate-500">
                        {formatDate(shift.openedAt)} →{" "}
                        {formatDate(shift.closedAt)}
                      </div>
                    </div>

                    <div className="text-right text-xs shrink-0">
                      <div>
                        Open:{" "}
                        {formatMoney(
                          openingCash,
                          currency,
                        )}
                      </div>

                      <div>
                        Close:{" "}
                        {closingCash !== null
                          ? formatMoney(
                              closingCash,
                              currency,
                            )
                          : "-"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  const [
    totalsRow,
    methodRows,
    expensesRow,
    bankRow,
    bookingsCountRow,
  ] = await Promise.all([
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
      .select({
        total: sql<string>`coalesce(sum(${expenses.amount}), 0)`,
      })
      .from(expenses)
      .where(eq(expenses.shiftId, active.id)),

    db
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
      .from(bankTransactions)
      .where(eq(bankTransactions.shiftId, active.id)),

    db
      .select({
        c: sql<number>`count(*)::int`,
      })
      .from(bookings)
      .where(eq(bookings.shiftId, active.id)),
  ]);

  const revenue = safeMoney(totalsRow[0]?.revenue);
  const seatTotal = safeMoney(totalsRow[0]?.seat);
  const ordersTotal = safeMoney(totalsRow[0]?.orders);
  const totalExpenses = safeMoney(expensesRow[0]?.total);
  const bankDeposits = safeMoney(bankRow[0]?.deposits);
  const bankWithdrawals = safeMoney(
    bankRow[0]?.withdrawals,
  );

  const cashTotal = safeMoney(
    methodRows.find(
      (method) => method.method === "cash",
    )?.total,
  );

  const visaTotal = safeMoney(
    methodRows.find(
      (method) => method.method === "visa",
    )?.total,
  );

  const instapayTotal = safeMoney(
    methodRows.find(
      (method) => method.method === "instapay",
    )?.total,
  );

  const openingCash = safeMoney(active.openingCash);

  const expectedCashInDrawer = Math.round(
    (
      openingCash +
      cashTotal -
      totalExpenses -
      bankDeposits +
      bankWithdrawals
    ) * 100,
  ) / 100;

  const bookingsCount = Math.max(
    0,
    safeNumber(bookingsCountRow[0]?.c, 0),
  );

  const openedAt = formatDate(active.openedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            My Shift · #{active.id}
          </h1>

          <p className="text-slate-500">
            Opened {openedAt} · Opening cash{" "}
            {formatMoney(openingCash, currency)}
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href="/bookings"
            className="btn btn-primary"
          >
            Bookings →
          </Link>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <StatBox
          label="Bookings this shift"
          value={String(bookingsCount)}
          icon="🪑"
        />

        <StatBox
          label="Seat charges"
          value={formatMoney(
            seatTotal,
            currency,
          )}
          icon="⏱️"
        />

        <StatBox
          label="F&B sales"
          value={formatMoney(
            ordersTotal,
            currency,
          )}
          icon="🍔"
        />

        <StatBox
          label="Total revenue"
          value={formatMoney(
            revenue,
            currency,
          )}
          icon="💰"
          highlight
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="font-bold mb-4">
            Payment breakdown
          </h3>

          <div className="space-y-3">
            <Line
              label="💵 Cash"
              value={formatMoney(
                cashTotal,
                currency,
              )}
            />

            <Line
              label="💳 Visa"
              value={formatMoney(
                visaTotal,
                currency,
              )}
            />

            <Line
              label="📱 InstaPay"
              value={formatMoney(
                instapayTotal,
                currency,
              )}
            />

            <div className="border-t border-slate-100 pt-3 mt-3">
              <Line
                label="🏦 Bank deposits"
                value={formatMoney(
                  bankDeposits,
                  currency,
                )}
              />

              <Line
                label="🏦 Bank withdrawals"
                value={formatMoney(
                  bankWithdrawals,
                  currency,
                )}
              />

              <Line
                label="💸 Expenses"
                value={formatMoney(
                  totalExpenses,
                  currency,
                )}
              />
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h3 className="font-bold mb-4">
            Cash drawer
          </h3>

          <div className="space-y-3 text-sm">
            <Line
              label="Opening cash"
              value={formatMoney(
                openingCash,
                currency,
              )}
            />

            <Line
              label="+ Cash sales"
              value={formatMoney(
                cashTotal,
                currency,
              )}
            />

            <Line
              label="− Cash expenses"
              value={formatMoney(
                totalExpenses,
                currency,
              )}
            />

            <Line
              label="− Deposited to bank"
              value={formatMoney(
                bankDeposits,
                currency,
              )}
            />

            <Line
              label="+ Withdrawn from bank"
              value={formatMoney(
                bankWithdrawals,
                currency,
              )}
            />
          </div>

          <div className="mt-4 p-4 rounded-xl bg-indigo-50 border border-indigo-200">
            <div className="text-xs text-indigo-700 font-semibold uppercase">
              Expected cash in drawer
            </div>

            <div className="text-2xl font-bold text-indigo-900 tabular-nums mt-1">
              {formatMoney(
                expectedCashInDrawer,
                currency,
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="font-bold mb-4">
          Close shift
        </h3>

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
        highlight
          ? "bg-gradient-to-br from-indigo-600 to-purple-600 text-white border-0"
          : ""
      }`}
    >
      <div
        className={`text-xs uppercase font-semibold ${
          highlight
            ? "text-white/80"
            : "text-slate-500"
        }`}
      >
        {label}
      </div>

      <div className="flex items-end justify-between mt-2 gap-3">
        <div className="text-xl font-bold tabular-nums">
          {value}
        </div>

        <div
          className="text-2xl"
          aria-hidden="true"
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-slate-600">
        {label}
      </span>

      <span className="font-semibold tabular-nums text-right">
        {value}
      </span>
    </div>
  );
}