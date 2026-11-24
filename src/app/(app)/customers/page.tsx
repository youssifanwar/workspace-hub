import { db } from "@/db";
import {
  customers,
  bookings,
  customerMeetingRoomPackages,
  meetingRoomReservations,
} from "@/db/schema";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { canManage, getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSetting } from "@/lib/settings";
import CustomerEditButton from "./CustomerEditButton";
import CustomerPackagesButton from "./CustomerPackagesButton";
import CustomerBalanceButton from "./CustomerBalanceButton";
import Link from "next/link";
import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";
import AddCustomerButton from "./AddCustomerButton";
import { activeTimeZone, loadTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const f = makeFmt(await getLang());
  const tx = f.t;
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

  const meetingRoomStatsRows = await db
    .select({
      customerId: meetingRoomReservations.customerId,
      standaloneVisits: sql<number>`count(*) filter (where ${meetingRoomReservations.status} not in ('cancelled', 'no_show') and ${meetingRoomReservations.bookingId} is null)::int`,
      standaloneHours: sql<string>`coalesce(sum(case when ${meetingRoomReservations.status} not in ('cancelled', 'no_show') and ${meetingRoomReservations.bookingId} is null then ${meetingRoomReservations.durationHours} else 0 end), 0)`,
      roomSpend: sql<string>`coalesce(sum(case when ${meetingRoomReservations.status} not in ('cancelled', 'no_show') and (${meetingRoomReservations.bookingId} is null or ${bookings.total} is null) then ${meetingRoomReservations.totalAmount} else 0 end), 0)`,
      lastRoomDate: sql<Date | null>`max(case when ${meetingRoomReservations.status} not in ('cancelled', 'no_show') then ${meetingRoomReservations.startAt} else null end)`,
    })
    .from(meetingRoomReservations)
    .leftJoin(bookings, eq(meetingRoomReservations.bookingId, bookings.id))
    .groupBy(meetingRoomReservations.customerId);

  const meetingRoomByCustomer = new Map(
    meetingRoomStatsRows.map((item) => [item.customerId, item]),
  );

  const customerRows = rows.map((customer) => {
    const meetingPackages = meetingPackageByCustomer.get(customer.id);
    const roomStats = meetingRoomByCustomer.get(customer.id);

    const combinedVisits =
      Number(customer.totalVisits || 0) +
      Number(roomStats?.standaloneVisits ?? 0);

    const combinedHours =
      parseFloat(customer.totalHours || "0") +
      parseFloat(roomStats?.standaloneHours ?? "0");

    const combinedSpent =
      parseFloat(customer.totalSpent || "0") +
      parseFloat(roomStats?.roomSpend ?? "0");

    const bookingLast = customer.lastVisit
      ? new Date(customer.lastVisit).getTime()
      : 0;
    const roomLast = roomStats?.lastRoomDate
      ? new Date(roomStats.lastRoomDate).getTime()
      : 0;

    const latestVisit =
      Math.max(bookingLast, roomLast) > 0
        ? new Date(Math.max(bookingLast, roomLast))
        : null;

    return {
      ...customer,
      totalVisits: combinedVisits,
      totalHours: combinedHours.toFixed(2),
      totalSpent: combinedSpent.toFixed(2),
      lastVisit: latestVisit,
      meetingPackageCount: Number(meetingPackages?.packageCount ?? 0),
      activeMeetingPackageCount: Number(
        meetingPackages?.activePackageCount ?? 0,
      ),
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
    {
      visits: 0,
      hours: 0,
      spent: 0,
      wallet: 0,
      activeMeetingPackages: 0,
      meetingPackageSpend: 0,
    },
  );

  const tz = activeTimeZone();

  return (
    <div className="x-page space-y-5">
      <div className="x-head">
        <div>
          <h1>{tx("العملاء")}</h1>
          <p>{customerRows.length} {term ? tx("نتيجة") : tx("عميل مسجّل")}.</p>
        </div>
        <div className="x-actions">
          <form method="get" className="flex gap-2">
            <input name="q" defaultValue={term} placeholder={tx("دوّر بالاسم أو التليفون أو الإيميل")} className="input" style={{ minWidth: 240 }} />
            <button type="submit" className="x-btn">{tx("بحث")}</button>
          </form>
          <AddCustomerButton />
        </div>
      </div>

      <div className="x-grid x-kpis">
        <div className="x-card x-kpi">
          <span className="x-kpi-label">{tx("العملاء")}</span>
          <div className="x-kpi-value x-num">{customerRows.length}</div>
          <div className="x-row-sub">{term ? tx("مطابقين للبحث") : tx("آخر 500 سجل")}</div>
        </div>
        <div className="x-card x-kpi">
          <span className="x-kpi-label">{tx("إجمالي الزيارات")}</span>
          <div className="x-kpi-value x-num">{summary.visits.toLocaleString("en-US")}</div>
          <div className="x-row-sub">{summary.hours.toFixed(1)} {tx("ساعة استخدام")}</div>
        </div>
        <div className="x-card x-kpi">
          <span className="x-kpi-label">{tx("إجمالي الإنفاق")}</span>
          <div className="x-kpi-value x-num">{f.number(summary.spent)}<small>{f.cur}</small></div>
          <div className="x-row-sub">{tx("أرصدة العملاء:")} {f.money(summary.wallet)}</div>
        </div>
        <div className="x-card x-kpi">
          <span className="x-kpi-label">{tx("باقات غرف الاجتماعات")}</span>
          <div className="x-kpi-value x-num">{summary.activeMeetingPackages}</div>
          <div className="x-row-sub">{tx("شغالة")} · {tx("قيمة المبيعات")} {f.money(summary.meetingPackageSpend)}</div>
        </div>
      </div>

      <div className="x-card" style={{ padding: 0 }}>
        <div className="x-table-wrap">
          <table className="x-table">
            <thead>
              <tr>
                <th>{tx("العميل")}</th>
                <th>{tx("التواصل")}</th>
                <th>{tx("عميل من")}</th>
                <th>{tx("الزيارات")}</th>
                <th>{tx("آخر زيارة")}</th>
                <th>{tx("باقات الغرف")}</th>
                <th>{tx("الإنفاق")}</th>
                <th>{tx("الرصيد")}</th>
                <th>{tx("إجراءات")}</th>
              </tr>
            </thead>
            <tbody>
              {customerRows.length === 0 ? (
                <tr><td colSpan={9} className="x-empty">{term ? (f.en ? `No customers match "${term}".` : `مفيش عملاء مطابقين لـ "${term}".`) : tx("لسه مفيش عملاء. ضيف أول عميل.")}</td></tr>
              ) : (
                customerRows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/customers/${c.id}`} className="flex items-center gap-3" style={{ textDecoration: "none", color: "inherit" }}>
                        <span className="x-kpi-ico tone-blue" style={{ width: 36, height: 36, fontWeight: 800 }}>{c.name.charAt(0)}</span>
                        <span>
                          <div className="x-row-title">{c.name}</div>
                          <div className="x-row-sub" style={{ marginTop: 0 }}>{tx("عميل")} #{c.id}</div>
                        </span>
                      </Link>
                    </td>
                    <td style={{ minWidth: 170 }}>
                      <div className="font-semibold x-num" dir="ltr" style={{ textAlign: "start" }}>{c.phone || "—"}</div>
                      {c.email ? <div className="x-row-sub break-all">{c.email}</div> : null}
                      {c.notes ? <div className="x-row-sub truncate" style={{ maxWidth: 220 }} title={c.notes}>📝 {c.notes}</div> : null}
                    </td>
                    <td className="x-num" style={{ whiteSpace: "nowrap" }}>{c.createdAt ? f.date(c.createdAt, tz) : "—"}</td>
                    <td className="x-num">{c.totalVisits} <span className="x-row-sub">({parseFloat(c.totalHours).toFixed(1)} {tx("س")})</span></td>
                    <td className="x-num" style={{ whiteSpace: "nowrap" }}>{c.lastVisit ? f.date(c.lastVisit, tz) : "—"}</td>
                    <td>
                      <span className={`x-pill ${c.activeMeetingPackageCount > 0 ? "green" : ""}`}>{c.activeMeetingPackageCount} {tx("شغالة")}</span>
                      <div className="x-row-sub">{c.meetingPackageCount} {tx("اتباعت")}</div>
                    </td>
                    <td className="font-bold x-num">{f.money(parseFloat(c.totalSpent))}</td>
                    <td className="font-bold x-num" style={{ color: Number(c.balance) > 0 ? "#1d4ed8" : "#94a3b8" }}>{f.money(Number(c.balance))}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <CustomerBalanceButton customerId={c.id} customerName={c.name} balance={Number(c.balance)} currency={currency} canAdjust={canManage(user.role)} />
                        <CustomerPackagesButton customerId={c.id} customerName={c.name} customerPhone={c.phone} currency={currency} balance={Number(c.balance)} canVoid={canManage(user.role)} />
                        <CustomerEditButton currency={currency} customer={{ id: c.id, name: c.name, phone: c.phone, email: c.email, notes: c.notes }} />
                      </div>
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
