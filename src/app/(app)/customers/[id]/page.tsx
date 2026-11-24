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
import { getCurrentUser } from "@/lib/auth";
import { arDate, arDateTime, arDuration, arMoney, arNumber, paymentLabel } from "@/lib/ar";
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

const STATUS_LABEL: Record<string, string> = {
  active: "شغالة",
  expired: "منتهية",
  exhausted: "خلصت",
  cancelled: "ملغية",
};

export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
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

  return (
    <div className="x-page space-y-5">
      <Link href="/customers" className="x-link" style={{ display: "inline-block" }}>→ رجوع لقائمة العملاء</Link>

      <section className="x-card">
        <div className="c-hero">
          <div className="c-avatar">{customer.name.charAt(0)}</div>
          <div className="flex-1 min-w-0">
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{customer.name}</h1>
            <div className="x-row-sub x-num" dir="ltr" style={{ textAlign: "start" }}>{customer.phone}{customer.email ? ` · ${customer.email}` : ""}</div>
            <div className="x-row-sub">عميل من {arDate(customer.createdAt, tz)}{last ? ` · آخر زيارة ${arDate(last, tz)}` : ""}</div>
          </div>
          <Link href="/customers" className="x-btn">تعديل من القائمة</Link>
        </div>
        {customer.notes ? <div className="x-note">📝 {customer.notes}</div> : null}
      </section>

      <div className="x-grid x-cols-3">
        <div className="x-card x-kpi">
          <span className="x-kpi-label">الرصيد المدفوع مقدماً</span>
          <div className="x-kpi-value x-num" style={{ color: Number(customer.balance) > 0 ? "#047857" : undefined }}>{arNumber(Number(customer.balance))}<small>ج.م</small></div>
        </div>
        <div className="x-card x-kpi">
          <span className="x-kpi-label">إجمالي الزيارات</span>
          <div className="x-kpi-value x-num">{visitCount}<small>زيارة</small></div>
        </div>
        <div className="x-card x-kpi">
          <span className="x-kpi-label">إجمالي الإنفاق</span>
          <div className="x-kpi-value x-num">{arNumber(spent)}<small>ج.م</small></div>
          <div className="x-row-sub">{visitCount > 0 ? `متوسط ${arMoney(spent / visitCount)} للزيارة` : "—"}</div>
        </div>
      </div>

      <section className="x-card">
        <div className="x-card-head"><h2>سجل الزيارات</h2></div>
        {visits.length === 0 ? <div className="x-empty">لسه مفيش زيارات.</div> : (
          <div className="x-table-wrap">
            <table className="x-table">
              <thead><tr><th>التاريخ</th><th>المكان</th><th>المدة</th><th>الكافيه</th><th>الإجمالي</th><th>الدفع</th></tr></thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id}>
                    <td className="x-num">{v.checkedInAt ? arDate(v.checkedInAt, tz) : "—"}</td>
                    <td>{v.deskName ?? "مساحة مفتوحة"}</td>
                    <td className="x-num">{v.checkedInAt ? arDuration(v.checkedInAt, v.checkedOutAt) : "—"}{v.status === "active" ? " (جارية)" : ""}</td>
                    <td className="x-num">{arMoney(Number(v.ordersTotal ?? 0))}</td>
                    <td className="font-bold x-num">{v.status === "active" ? <span className="x-pill green">نشطة</span> : arMoney(Number(v.total ?? 0))}</td>
                    <td>{v.status === "active" ? "—" : paymentLabel(v.paymentMethod)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="x-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <section className="x-card">
          <div className="x-card-head"><h2>حركات الرصيد</h2></div>
          {txs.length === 0 ? <div className="x-empty">مفيش حركات.</div> : (
            <table className="x-table">
              <thead><tr><th>التاريخ</th><th>العملية</th><th>المبلغ</th></tr></thead>
              <tbody>
                {txs.map((t) => {
                  const amt = Number(t.amount);
                  return (
                    <tr key={t.id}>
                      <td className="x-num">{arDate(t.createdAt, tz)}</td>
                      <td>{TX_LABEL[t.type] ?? t.type}{t.paymentMethod ? ` · ${paymentLabel(t.paymentMethod)}` : ""}</td>
                      <td className={`x-num ${amt >= 0 ? "x-in" : "x-out"}`} dir="ltr" style={{ textAlign: "start" }}>{amt >= 0 ? "+" : "−"}{arNumber(Math.abs(amt))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="x-card">
          <div className="x-card-head"><h2>الباقات</h2></div>
          {subs.length === 0 && meetingPkgs.length === 0 ? <div className="x-empty">مفيش باقات.</div> : (
            <div className="x-list">
              {subs.map((p) => (
                <div key={`s${p.id}`} className="x-row">
                  <div className="x-row-main"><div className="x-row-title">{p.packageNameSnapshot}</div><div className="x-row-sub">{Number(p.totalHoursSnapshot)} ساعة · ينتهي {arDate(p.expiresAt, tz)}</div></div>
                  <span className={`x-pill ${p.status === "active" ? "green" : ""}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                </div>
              ))}
              {meetingPkgs.map((p) => (
                <div key={`m${p.id}`} className="x-row">
                  <div className="x-row-main"><div className="x-row-title">{p.packageNameSnapshot}</div><div className="x-row-sub">باقة غرف اجتماعات · {arMoney(Number(p.priceSnapshot))}</div></div>
                  <span className={`x-pill ${p.status === "active" ? "green" : ""}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {reservations.length > 0 && (
        <section className="x-card">
          <div className="x-card-head"><h2>حجوزات غرف الاجتماعات</h2></div>
          <div className="x-list">
            {reservations.map((r) => (
              <div key={r.id} className="x-row">
                <div className="x-row-main"><div className="x-row-title">{r.roomName}</div><div className="x-row-sub x-num">{arDateTime(r.startAt, tz)}</div></div>
                <b className="x-num">{arMoney(Number(r.total))}</b>
                <span className="x-pill">{r.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
