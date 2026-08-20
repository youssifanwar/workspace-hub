import { db } from "@/db";
import { customers, bookings } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSetting, formatMoney } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const currency = await getSetting("currency");

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      createdAt: customers.createdAt,
      totalVisits: sql<number>`count(${bookings.id})::int`,
      totalSpent: sql<string>`coalesce(sum(${bookings.total}), 0)`,
      lastVisit: sql<Date | null>`max(${bookings.checkedInAt})`,
    })
    .from(customers)
    .leftJoin(bookings, eq(bookings.customerId, customers.id))
    .groupBy(customers.id)
    .orderBy(desc(customers.createdAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Customers</h1>
        <p className="text-slate-500">
          {rows.length} customer{rows.length === 1 ? "" : "s"} registered.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Phone</th>
                <th className="py-3 px-4">Visits</th>
                <th className="py-3 px-4">Last visit</th>
                <th className="py-3 px-4 text-right">Total spent</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-slate-400">
                    No customers yet
                  </td>
                </tr>
              ) : (
                rows.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-bold">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="font-semibold">{c.name}</div>
                      </div>
                    </td>
                    <td className="py-3 px-4">📞 {c.phone}</td>
                    <td className="py-3 px-4">{c.totalVisits}</td>
                    <td className="py-3 px-4 text-slate-500">
                      {c.lastVisit ? new Date(c.lastVisit).toLocaleString() : "-"}
                    </td>
                    <td className="py-3 px-4 text-right font-bold tabular-nums">
                      {formatMoney(parseFloat(c.totalSpent), currency)}
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
