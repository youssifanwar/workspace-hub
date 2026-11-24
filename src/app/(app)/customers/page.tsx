import { PageBar, StatStrip, Panel } from "../_components/ui";
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
      const bal = Number(customer.balance) || 0;
      if (bal >= 0) acc.wallet += bal;
      else { acc.owed += -bal; acc.owing += 1; }
      acc.activeMeetingPackages += customer.activeMeetingPackageCount;
      acc.meetingPackageSpend += customer.meetingPackageSpend;
      return acc;
    },
    {
      visits: 0,
      hours: 0,
      spent: 0,
      wallet: 0,
      owed: 0,
      owing: 0,
      activeMeetingPackages: 0,
      meetingPackageSpend: 0,
    },
  );

  const tz = activeTimeZone();

  return (
    <div>
      <PageBar
        crumb={tx("Directory")}
        title={tx("العملاء")}
        description={`${customerRows.length} ${term ? tx("نتيجة") : tx("عميل مسجّل")}.`}
        actions={<AddCustomerButton />}
      />

      <StatStrip
        items={[
          { label: tx("العملاء"), value: customerRows.length, hint: term ? tx("مطابقين للبحث") : tx("آخر 500 سجل"), tone: "brand" },
          { label: tx("إجمالي الزيارات"), value: summary.visits.toLocaleString("en-US"), hint: `${summary.hours.toFixed(1)} ${tx("ساعة استخدام")}`, tone: "slate" },
          { label: tx("إجمالي الإنفاق"), value: f.money(summary.spent), hint: `${tx("أرصدة العملاء:")} ${f.money(summary.wallet)}${summary.owed > 0 ? ` · ${f.en ? "Owed to us" : "مديونيات"}: ${f.money(summary.owed)} (${summary.owing})` : ""}`, tone: "green" },
          { label: tx("باقات غرف الاجتماعات"), value: summary.activeMeetingPackages, hint: `${tx("شغالة")} · ${tx("قيمة المبيعات")} ${f.money(summary.meetingPackageSpend)}`, tone: "amber" },
        ]}
      />

      <Panel flush>
        <form method="get" className="v2-toolbar">
          <input data-v2search=""
            name="q"
            defaultValue={term}
            placeholder={tx("دوّر بالاسم أو التليفون أو الإيميل")}
            className="input"
            style={{ flex: 1, maxWidth: 420 }}
          />
          <button type="submit" className="btn btn-primary">{tx("بحث")}</button>
          {term ? (
            <Link href="/customers" className="btn btn-ghost">{tx("Clear")}</Link>
          ) : null}
        </form>

        <div className="x-table-wrap">
          <table className="v2-tbl">
            <thead>
              <tr>
                <th>{tx("العميل")}</th>
                <th>{tx("التواصل")}</th>
                <th>{tx("الزيارات")}</th>
                <th>{tx("باقات الغرف")}</th>
                <th className="num">{tx("الإنفاق")}</th>
                <th className="num">{tx("الرصيد")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {customerRows.length === 0 ? (
                <tr><td colSpan={7} className="v2-empty">{term ? (f.en ? `No customers match "${term}".` : `مفيش عملاء مطابقين لـ "${term}".`) : tx("لسه مفيش عملاء. ضيف أول عميل.")}</td></tr>
              ) : (
                customerRows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/customers/${c.id}`} className="v2-prod" style={{ textDecoration: "none" }}>
                        <span className="v2-prod-ico" style={{ background: "#eef0ff", color: "#4f46e5", fontWeight: 800, fontSize: 15 }}>{c.name.charAt(0)}</span>
                        <span>
                          <b style={{ color: "#111827", display: "block" }}>{c.name}</b>
                          <span style={{ color: "#6b7280", fontSize: 12 }}>
                            #{c.id} · {c.createdAt ? f.date(c.createdAt, tz) : "—"}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td style={{ minWidth: 170 }}>
                      <div dir="ltr" style={{ textAlign: "start", fontWeight: 650 }}>{c.phone || "—"}</div>
                      {c.email ? <div className="muted">{c.email}</div> : null}
                    </td>
                    <td>
                      <b>{c.totalVisits}</b> <span className="muted">({parseFloat(c.totalHours).toFixed(1)} {tx("س")})</span>
                      <div className="muted">{c.lastVisit ? f.date(c.lastVisit, tz) : "—"}</div>
                    </td>
                    <td>
                      <span className={`v2-tag ${c.activeMeetingPackageCount > 0 ? "green" : "slate"}`}>{c.activeMeetingPackageCount} {tx("شغالة")}</span>
                      <div className="muted">{c.meetingPackageCount} {tx("اتباعت")}</div>
                    </td>
                    <td className="num">{f.money(parseFloat(c.totalSpent))}</td>
                    <td className="num">
                      {Number(c.balance) < 0 ? (
                        <span className="v2-debt">{f.en ? "Owes" : "عليه"} {f.money(Math.abs(Number(c.balance)))}</span>
                      ) : (
                        <span className={`v2-tag ${Number(c.balance) > 0 ? "blue" : "slate"}`}>{f.money(Number(c.balance))}</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
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
      </Panel>
    </div>
  );
}
