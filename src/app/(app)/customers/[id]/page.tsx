import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  bookings,
  customerBalanceTransactions,
  customerSubscriptions,
  customerMeetingRoomPackages,
  customers,
  desks,
  meetingRoomReservations,
} from "@/db/schema";
import { canManage, getCurrentUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { PageBar, Panel, StatStrip } from "../../_components/ui";
import CustomerEditButton from "../CustomerEditButton";
import CustomerBalanceButton from "../CustomerBalanceButton";
import CustomerPackagesButton from "../CustomerPackagesButton";
import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";
import { activeTimeZone, loadTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

const TX_LABEL: Record<string, string> = {
  topup: "شحن رصيد",
  deposit: "شحن رصيد",
  spend: "خصم",
  charge: "خصم",
  refund: "استرجاع",
  adjustment: "تعديل",
  adjust: "تعديل",
};

const RES_LABEL: Record<string, string> = {
  confirmed: "مؤكد",
  active: "شغال",
  completed: "خلص",
  cancelled: "ملغي",
  no_show: "ما حضرش",
  pending: "في الانتظار",
};

const STATUS_LABEL: Record<string, string> = {
  active: "شغالة",
  expired: "منتهية",
  exhausted: "خلصت",
  cancelled: "ملغية",
};

export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const f = makeFmt(await getLang());
  const tx = f.t;
  const user = await getCurrentUser();
  await loadTimezone();
  if (!user) redirect("/login");

  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) notFound();

  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) notFound();

  const tz = activeTimeZone();

  const [visits, stats, txs, subs, meetingPkgs, reservations] = await Promise.all([
    db
      .select({
        id: bookings.id,
        status: bookings.status,
        checkedInAt: bookings.checkedInAt,
        checkedOutAt: bookings.checkedOutAt,
        seatCharge: bookings.seatCharge,
        ordersTotal: bookings.ordersTotal,
        total: bookings.total,
        paymentMethod: bookings.paymentMethod,
        deskName: desks.name,
      })
      .from(bookings)
      .leftJoin(desks, eq(desks.id, bookings.deskId))
      .where(eq(bookings.customerId, customerId))
      .orderBy(desc(bookings.checkedInAt))
      .limit(15),
    db
      .select({
        visits: sql<number>`count(*)::int`,
        spent: sql<string>`coalesce(sum(${bookings.total}), 0)`,
        last: sql<Date | null>`max(${bookings.checkedInAt})`,
      })
      .from(bookings)
      .where(eq(bookings.customerId, customerId)),
    db
      .select()
      .from(customerBalanceTransactions)
      .where(eq(customerBalanceTransactions.customerId, customerId))
      .orderBy(desc(customerBalanceTransactions.createdAt))
      .limit(10),
    db
      .select()
      .from(customerSubscriptions)
      .where(eq(customerSubscriptions.customerId, customerId))
      .orderBy(desc(customerSubscriptions.purchasedAt))
      .limit(6),
    db
      .select()
      .from(customerMeetingRoomPackages)
      .where(eq(customerMeetingRoomPackages.customerId, customerId))
      .orderBy(desc(customerMeetingRoomPackages.purchasedAt))
      .limit(6),
    db
      .select({
        id: meetingRoomReservations.id,
        startAt: meetingRoomReservations.startAt,
        total: meetingRoomReservations.totalAmount,
        status: meetingRoomReservations.status,
        roomName: desks.name,
      })
      .from(meetingRoomReservations)
      .innerJoin(desks, eq(desks.id, meetingRoomReservations.deskId))
      .where(eq(meetingRoomReservations.customerId, customerId))
      .orderBy(desc(meetingRoomReservations.startAt))
      .limit(5),
  ]);

  const s = stats[0];
  const visitCount = Number(s?.visits ?? 0);
  const spent = Number(s?.spent ?? 0);
  const last = s?.last ? new Date(s.last) : null;

  const currency = await getSetting("currency");
  const manage = canManage(user.role);
  const balance = Number(customer.balance);

  return (
    <div>
      <PageBar
        crumb={<Link href="/customers" style={{ color: "inherit", textDecoration: "none" }}>{f.en ? "←" : "→"} {tx("رجوع لقائمة العملاء")}</Link>}
        title={customer.name}
        description={`${tx("عميل من")} ${f.date(customer.createdAt, tz)}${last ? ` · ${tx("آخر زيارة")} ${f.date(last, tz)}` : ""}`}
      />

      <div className="v2-split rev">
        <aside className="v2-sticky" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Panel>
            <div className="v2-profile">
              <div className="v2-profile-avatar">{customer.name.charAt(0)}</div>
              <b>{customer.name}</b>
              <span dir="ltr">{customer.phone}</span>
              {customer.email ? <span dir="ltr">{customer.email}</span> : null}
            </div>
            {customer.notes ? <div className="v2-note">📝 {customer.notes}</div> : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              <CustomerEditButton currency={currency} customer={{ id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, notes: customer.notes }} />
            </div>
          </Panel>

          <div className="v2-wallet" style={balance < 0 ? { background: "linear-gradient(135deg,#991b1b,#dc2626)" } : undefined}>
            <span className="v2-wallet-label">{balance < 0 ? (f.en ? "Outstanding debt (owes us)" : "مديونية على العميل") : tx("الرصيد المدفوع مقدماً")}</span>
            <span className="v2-wallet-value" style={balance < 0 ? { color: "#fecaca" } : undefined}>{f.money(Math.abs(balance))}</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <CustomerBalanceButton customerId={customer.id} customerName={customer.name} balance={balance} currency={currency} canAdjust={manage} />
              <CustomerPackagesButton customerId={customer.id} customerName={customer.name} customerPhone={customer.phone} currency={currency} balance={balance} canVoid={manage} />
            </div>
          </div>
        </aside>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
          <StatStrip
            items={[
              { label: tx("إجمالي الزيارات"), value: `${visitCount} ${tx("زيارة")}`, tone: "brand" },
              { label: tx("إجمالي الإنفاق"), value: f.money(spent), hint: visitCount > 0 ? (f.en ? `Average ${f.money(spent / visitCount)} per visit` : `متوسط ${f.money(spent / visitCount)} للزيارة`) : "—", tone: "green" },
            ]}
          />

          <Panel title={tx("سجل الزيارات")} flush>
            {visits.length === 0 ? <div className="v2-empty">{tx("لسه مفيش زيارات.")}</div> : (
              <div className="x-table-wrap">
                <table className="v2-tbl">
                  <thead><tr><th>{tx("التاريخ")}</th><th>{tx("المكان")}</th><th>{tx("المدة")}</th><th>{tx("الكافيه")}</th><th>{tx("الدفع")}</th><th className="num">{tx("الإجمالي")}</th></tr></thead>
                  <tbody>
                    {visits.map((v) => (
                      <tr key={v.id}>
                        <td className="muted">{v.checkedInAt ? f.date(v.checkedInAt, tz) : "—"}</td>
                        <td>{v.deskName ?? tx("مساحة مفتوحة")}</td>
                        <td>{v.checkedInAt ? f.duration(v.checkedInAt, v.checkedOutAt) : "—"}</td>
                        <td className="muted">{f.money(Number(v.ordersTotal ?? 0))}</td>
                        <td className="muted">{v.status === "active" ? "—" : f.pay(v.paymentMethod)}</td>
                        <td className="num">{v.status === "active" ? <span className="v2-tag green">{tx("نشطة")}</span> : f.money(Number(v.total ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="v2-two">
            <Panel title={tx("حركات الرصيد")} flush>
              {txs.length === 0 ? <div className="v2-empty">{tx("مفيش حركات.")}</div> : (
                <table className="v2-tbl">
                  <thead><tr><th>{tx("التاريخ")}</th><th>{tx("العملية")}</th><th className="num">{tx("المبلغ")}</th></tr></thead>
                  <tbody>
                    {txs.map((t) => {
                      const amt = Number(t.amount);
                      return (
                        <tr key={t.id}>
                          <td className="muted">{f.date(t.createdAt, tz)}</td>
                          <td>{tx(TX_LABEL[t.type] ?? t.type)}{t.paymentMethod ? ` · ${f.pay(t.paymentMethod)}` : ""}</td>
                          <td className="num" dir="ltr" style={{ color: amt >= 0 ? "#047857" : "#b91c1c" }}>{amt >= 0 ? "+" : "−"}{f.number(Math.abs(amt))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title={tx("الباقات")} flush>
              {subs.length === 0 && meetingPkgs.length === 0 ? <div className="v2-empty">{tx("مفيش باقات.")}</div> : (
                <div className="v2-list">
                  {subs.map((p) => (
                    <div key={`s${p.id}`} className="v2-list-row">
                      <div><b>{p.packageNameSnapshot}</b><small>{Number(p.totalHoursSnapshot)} {tx("ساعة")} · {tx("ينتهي")} {f.date(p.expiresAt, tz)}</small></div>
                      <span className={`v2-tag ${p.status === "active" ? "green" : "slate"}`}>{tx(STATUS_LABEL[p.status] ?? p.status)}</span>
                    </div>
                  ))}
                  {meetingPkgs.map((p) => (
                    <div key={`m${p.id}`} className="v2-list-row">
                      <div><b>{p.packageNameSnapshot}</b><small>{tx("باقة غرف اجتماعات")} · {f.money(Number(p.priceSnapshot))}</small></div>
                      <span className={`v2-tag ${p.status === "active" ? "green" : "slate"}`}>{tx(STATUS_LABEL[p.status] ?? p.status)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {reservations.length > 0 && (
            <Panel title={tx("حجوزات غرف الاجتماعات")} flush>
              <div className="v2-list">
                {reservations.map((r) => (
                  <div key={r.id} className="v2-list-row">
                    <div><b>{r.roomName}</b><small>{f.dateTime(r.startAt, tz)}</small></div>
                    <b>{f.money(Number(r.total))}</b>
                    <span className={`v2-tag ${r.status === "confirmed" || r.status === "active" ? "green" : "slate"}`}>{tx(RES_LABEL[r.status] ?? r.status)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
