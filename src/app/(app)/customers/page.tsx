import { db } from "@/db";
import { customers, bookings, customerMeetingRoomPackages } from "@/db/schema";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { canManage, getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSetting, formatMoney } from "@/lib/settings";
import CustomerEditButton from "./CustomerEditButton";
import CustomerPackagesButton from "./CustomerPackagesButton";
import CustomerBalanceButton from "./CustomerBalanceButton";
import { PageHeader } from "../_components/ui";
import AddCustomerButton from "./AddCustomerButton";
import { activeTimeZone, loadTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  await loadTimezone();
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
        ilike(customers.email, `%${escaped}%`),
        ilike(customers.notes, `%${escaped}%`),
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
      balance: customers.balance,
      createdAt: customers.createdAt,
      totalHours: sql<string>`coalesce(sum(greatest(0, extract(epoch from (coalesce(${bookings.checkedOutAt}, now()) - ${bookings.checkedInAt})) / 3600)), 0)`,
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

  const meetingPackageRows = await db
    .select({
      customerId: customerMeetingRoomPackages.customerId,
      packageCount: sql<number>`count(*) filter (where ${customerMeetingRoomPackages.status} <> 'cancelled')::int`,
      activePackageCount: sql<number>`count(*) filter (where ${customerMeetingRoomPackages.status} = 'active')::int`,
      packageSpend: sql<string>`coalesce(sum(case when ${customerMeetingRoomPackages.status} <> 'cancelled' then ${customerMeetingRoomPackages.priceSnapshot} else 0 end), 0)`,
    })
    .from(customerMeetingRoomPackages)
    .groupBy(customerMeetingRoomPackages.customerId);
  const meetingPackageByCustomer = new Map(
    meetingPackageRows.map((item) => [item.customerId, item]),
  );
  const customerRows = rows.map((customer) => {
    const meetingPackages = meetingPackageByCustomer.get(customer.id);
    return {
      ...customer,
      meetingPackageCount: Number(meetingPackages?.packageCount ?? 0),
      activeMeetingPackageCount: Number(meetingPackages?.activePackageCount ?? 0),
      meetingPackageSpend: Number(meetingPackages?.packageSpend ?? 0),
    };
  });

  const summary = customerRows.reduce(
    (acc, customer) => {
      acc.visits += Number(customer.totalVisits) || 0;
      acc.hours += Number(customer.totalHours) || 0;
      acc.spent += Number(customer.totalSpent) || 0;
      acc.wallet += Number(customer.balance) || 0;
      acc.activeMeetingPackages += customer.activeMeetingPackageCount;
      acc.meetingPackageSpend += customer.meetingPackageSpend;
      return acc;
    },
    { visits: 0, hours: 0, spent: 0, wallet: 0, activeMeetingPackages: 0, meetingPackageSpend: 0 },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description={`${customerRows.length} customer${customerRows.length === 1 ? "" : "s"} ${term ? "found" : "registered"}.`}
        actions={
          <>
          <form method="get" className="flex gap-2">
            <input
              name="q"
              defaultValue={term}
              placeholder="Search name, phone, email or notes"
              className="input"
            />
            <button type="submit" className="btn btn-ghost">
              Search
            </button>
          </form>
          <AddCustomerButton />
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="card p-5 border border-slate-200/80">
          <div className="text-xs uppercase tracking-[.12em] text-slate-500 font-semibold">Customers shown</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{customerRows.length}</div>
          <div className="mt-1 text-xs text-slate-500">{term ? "Matching your search" : "Most recent 500 records"}</div>
        </div>
        <div className="card p-5 border border-slate-200/80">
          <div className="text-xs uppercase tracking-[.12em] text-slate-500 font-semibold">Total visits</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{summary.visits.toLocaleString("en-EG")}</div>
          <div className="mt-1 text-xs text-slate-500">Across the customers shown</div>
        </div>
        <div className="card p-5 border border-slate-200/80">
          <div className="text-xs uppercase tracking-[.12em] text-slate-500 font-semibold">Hours used</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{summary.hours.toFixed(1)}<span className="ml-1 text-base font-semibold text-slate-500">h</span></div>
          <div className="mt-1 text-xs text-slate-500">Estimated from booking check-ins</div>
        </div>
        <div className="card p-5 border border-slate-200/80">
          <div className="text-xs uppercase tracking-[.12em] text-slate-500 font-semibold">Booking spend</div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{formatMoney(summary.spent, currency)}</div>
          <div className="mt-1 text-xs text-slate-500">Booking totals · Wallet balance: {formatMoney(summary.wallet, currency)}</div>
        </div>
        <div className="card p-5 border border-slate-200/80">
          <div className="text-xs uppercase tracking-[.12em] text-slate-500 font-semibold">Meeting room packages</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{summary.activeMeetingPackages}</div>
          <div className="mt-1 text-xs text-slate-500">Active packages · Sold value: {formatMoney(summary.meetingPackageSpend, currency)}</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Contact & notes</th>
                <th className="py-3 px-4">Customer since</th>
                <th className="py-3 px-4">Visits</th>
                <th className="py-3 px-4">Hours used</th>
                <th className="py-3 px-4">Last visit</th>
                <th className="py-3 px-4">Meeting packages</th>
                <th className="py-3 px-4 text-right">Booking spend</th>
                <th className="py-3 px-4 text-right">Balance</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-slate-400">
                    {term
                      ? `No customers match "${term}".`
                      : "No customers yet. Add your first customer to get started."}
                  </td>
                </tr>
              ) : (
                customerRows.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-bold">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{c.name}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">Customer #{c.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 min-w-52">
                      <div className="font-medium text-slate-700">{c.phone || "No phone"}</div>
                      {c.email ? <div className="text-xs text-slate-500 mt-1 break-all">{c.email}</div> : <div className="text-xs text-slate-400 mt-1">No email added</div>}
                      {c.notes ? <div className="text-xs text-slate-500 mt-2 max-w-64 truncate" title={c.notes}>Note: {c.notes}</div> : null}
                    </td>
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                      {c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-EG", { timeZone: activeTimeZone() }) : "—"}
                    </td>
                    <td className="py-3 px-4">{c.totalVisits}</td>
                    <td className="py-3 px-4 tabular-nums">
                      {parseFloat(c.totalHours).toFixed(1)} h
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {c.lastVisit ? new Date(c.lastVisit).toLocaleString("en-EG", { timeZone: activeTimeZone() }) : "-"}
                    </td>
                    <td className="py-3 px-4 min-w-36">
                      <div className="font-semibold text-slate-800">{c.activeMeetingPackageCount} active</div>
                      <div className="text-xs text-slate-500 mt-1">{c.meetingPackageCount} purchased · {formatMoney(c.meetingPackageSpend, currency)}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-bold tabular-nums">
                      {formatMoney(parseFloat(c.totalSpent), currency)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold tabular-nums">
                      <span
                        className={
                          Number(c.balance) > 0
                            ? "text-indigo-700"
                            : "text-slate-400"
                        }
                      >
                        {formatMoney(Number(c.balance), currency)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <CustomerBalanceButton
                        customerId={c.id}
                        customerName={c.name}
                        balance={Number(c.balance)}
                        currency={currency}
                        canAdjust={canManage(user.role)}
                      />
                      <CustomerPackagesButton
                        customerId={c.id}
                        customerName={c.name}
                        customerPhone={c.phone}
                        currency={currency}
                        balance={Number(c.balance)}
                        canVoid={canManage(user.role)}
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
