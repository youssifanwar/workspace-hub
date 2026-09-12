import { db } from "@/db";
import { customers, bookings } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSetting, formatMoney } from "@/lib/settings";
import CustomerSubscriptionButton from "./CustomerSubscriptionButton";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const currency = await getSetting("currency");

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      createdAt: customers.createdAt,
      totalVisits:
        sql<number>`count(${bookings.id})::int`,
      totalSpent:
        sql<string>`coalesce(sum(${bookings.total}), 0)`,
      lastVisit:
        sql<Date | null>`max(${bookings.checkedInAt})`,
    })
    .from(customers)
    .leftJoin(
      bookings,
      eq(
        bookings.customerId,
        customers.id,
      ),
    )
    .groupBy(customers.id)
    .orderBy(desc(customers.createdAt))
    .limit(200);

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Customers
          </h1>

          <p className="text-slate-500">
            {rows.length} customer
            {rows.length === 1 ? "" : "s"} registered.
          </p>
        </div>

        {/* HEADER ACTIONS */}
        <div className="flex items-center gap-2">
          {/* EXPORT EXCEL */}
          <a
            href="/api/customers/export"
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
          >
            <span>📊</span>
            <span>Export Excel</span>
          </a>

          {/* NEW CUSTOMER */}
          <CustomerSubscriptionButton
            showNewCustomer={true}
          />
        </div>
      </div>

      {/* CUSTOMER TABLE */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-3 px-4">
                  Name
                </th>

                <th className="py-3 px-4">
                  Phone
                </th>

                <th className="py-3 px-4">
                  Visits
                </th>

                <th className="py-3 px-4">
                  Last visit
                </th>

                <th className="py-3 px-4 text-right">
                  Total spent
                </th>

                <th className="py-3 px-4">
                  Subscription
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-10 text-center text-slate-400"
                  >
                    No customers yet
                  </td>
                </tr>
              ) : (
                rows.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-slate-100 hover:bg-slate-50"
                  >
                    {/* NAME */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-indigo-100 font-bold text-indigo-700">
                          {c.name
                            .charAt(0)
                            .toUpperCase()}
                        </div>

                        <div className="font-semibold text-slate-900">
                          {c.name}
                        </div>
                      </div>
                    </td>

                    {/* PHONE */}
                    <td className="py-3 px-4">
                      <span className="whitespace-nowrap">
                        📞 {c.phone}
                      </span>
                    </td>

                    {/* VISITS */}
                    <td className="py-3 px-4 tabular-nums">
                      {c.totalVisits}
                    </td>

                    {/* LAST VISIT */}
                    <td className="py-3 px-4 text-slate-500">
                      {c.lastVisit
                        ? new Date(
                            c.lastVisit,
                          ).toLocaleString(
                            "en-EG",
                          )
                        : "-"}
                    </td>

                    {/* TOTAL SPENT */}
                    <td className="py-3 px-4 text-right font-bold tabular-nums">
                      {formatMoney(
                        parseFloat(
                          c.totalSpent,
                        ),
                        currency,
                      )}
                    </td>

                    {/* SUBSCRIPTION */}
                    <td className="min-w-[240px] py-3 px-4">
                      <CustomerSubscriptionButton
                        customerId={c.id}
                        showNewCustomer={false}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}