import { db } from "@/db";
import { customers, bookings } from "@/db/schema";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSetting, formatMoney } from "@/lib/settings";
import CustomerEditButton from "./CustomerEditButton";
import CustomerPackagesButton from "./CustomerPackagesButton";
import AddCustomerButton from "./AddCustomerButton";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const currency = await getSetting("currency");
  const { q } = await searchParams;
  const term = (q ?? "").trim().slice(0, 100);
  const digits = term.replace(/\D/g, "");
  const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);
  const filter = term
    ? or(
        ilike(customers.name, `%${escaped}%`),
        ilike(customers.phone, `%${escaped}%`),
        digits ? ilike(customers.phoneNormalized, `%${digits}%`) : undefined,
      )
    : undefined;

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      notes: customers.notes,
      createdAt: customers.createdAt,
      totalVisits: sql<number>`count(${bookings.id})::int`,
      totalSpent: sql<string>`coalesce(sum(${bookings.total}), 0)`,
      lastVisit: sql<Date | null>`max(${bookings.checkedInAt})`,
    })
    .from(customers)
    .leftJoin(bookings, eq(bookings.customerId, customers.id))
    .where(filter)
    .groupBy(customers.id)
    .orderBy(desc(customers.createdAt))
    .limit(500);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Customers</h1>
          <p className="text-slate-500">
            {rows.length} customer{rows.length === 1 ? "" : "s"}{" "}
            {term ? "found" : "registered"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form method="get" className="flex gap-2">
            <input
              name="q"
              defaultValue={term}
              placeholder="Search name or phone"
              className="input"
            />
            <button type="submit" className="btn btn-ghost">
              Search
            </button>
          </form>
          <AddCustomerButton />
        </div>
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
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400">
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
                    <td className="py-3 px-4 text-right">
                      <CustomerPackagesButton
                        customerId={c.id}
                        customerName={c.name}
                        customerPhone={c.phone}
                        currency={currency}
                      />
                      <CustomerEditButton
                        currency={currency}
                        customer={{
                          id: c.id,
                          name: c.name,
                          phone: c.phone,
                          email: c.email,
                          notes: c.notes,
                        }}
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
