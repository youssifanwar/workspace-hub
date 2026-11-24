import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { auditLogs, bookings, customers, shifts, users } from "@/db/schema";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { arDate, arDateTime, arDuration, arMoney, arNumber, arTime, paymentLabel } from "@/lib/ar";
import { activeTimeZone, loadTimezone } from "@/lib/timezone";
import Icon from "../_components/Icon";

export const dynamic = "force-dynamic";

const RANGES: Record<string, { label: string; days: number }> = {
  today: { label: "النهارده", days: 1 },
  "7d": { label: "آخر 7 أيام", days: 7 },
  "30d": { label: "آخر 30 يوم", days: 30 },
};

type Move = {
  at: Date;
  kind: "in" | "out";
  source: string;
  detail: string | null;
  method: string | null;
  amount: number;
  staff: string | null;
  shift_id: number | null;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

export default async function OwnerAdminPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await getCurrentUser();
  await loadTimezone();
  if (!user) redirect("/login");
  // Owner-only page: same rule the staff-shifts settings page already uses.
  if (!isAdmin(user.role)) notFound();

  const { range } = await searchParams;
  const key = range && RANGES[range] ? range : "today";
  const tz = activeTimeZone();

  // Start of the first day of the range in the workspace timezone.
  const dayStart = (await db.execute(sql`
    select (date_trunc('day', now() at time zone ${tz}) - make_interval(days => ${RANGES[key].days - 1})) at time zone ${tz} as d
  `)).rows?.[0] as { d: Date | string };
  const from = new Date(dayStart.d);

  const [movesRes, shiftRows, sessionRows, handoverRows, openShiftRows, userRows] = await Promise.all([
    db.execute(sql`
      select * from (
        select b.checked_out_at as at, 'in' as kind, 'جلسة عميل' as source, c.name as detail,
               b.payment_method::text as method, b.total::numeric as amount, u.full_name as staff, b.shift_id
          from bookings b join customers c on c.id = b.customer_id left join users u on u.id = b.user_id
          where b.status = 'closed' and b.checked_out_at >= ${from}
        union all
        select s.created_at, 'in', 'بيع مباشر', s.note, s.payment_method::text, s.total, u.full_name, s.shift_id
          from fnb_sales s left join users u on u.id = s.user_id where s.created_at >= ${from}
        union all
        select m.created_at, 'in', 'إيراد يدوي', coalesce(m.category, '') || coalesce(' · ' || m.note, ''), m.payment_method::text, m.amount, u.full_name, m.shift_id
          from manual_incomes m left join users u on u.id = m.user_id where m.created_at >= ${from}
        union all
        select p.purchased_at, 'in', 'باقة', p.package_name_snapshot, p.payment_method::text, p.price_snapshot, u.full_name, p.shift_id
          from customer_subscriptions p left join users u on u.id = p.created_by_user_id
          where p.status <> 'cancelled' and p.purchased_at >= ${from}
        union all
        select e.created_at, 'out', 'مصروف', coalesce(e.category, '') || coalesce(' · ' || e.note, ''), e.payment_method::text, e.amount, u.full_name, e.shift_id
          from expenses e left join users u on u.id = e.user_id where e.created_at >= ${from}
      ) t where at is not null order by at desc limit 60
    `),
    db
      .select({
        id: shifts.id,
        userId: shifts.userId,
        openedAt: shifts.openedAt,
        closedAt: shifts.closedAt,
        openingCash: shifts.openingCash,
        closingCash: shifts.closingCash,
        note: shifts.note,
        staff: users.fullName,
      })
      .from(shifts)
      .innerJoin(users, eq(users.id, shifts.userId))
      .where(gte(shifts.openedAt, from))
      .orderBy(desc(shifts.openedAt))
      .limit(30),
    db
      .select({
        id: bookings.id,
        customer: customers.name,
        status: bookings.status,
        checkedInAt: bookings.checkedInAt,
        checkedOutAt: bookings.checkedOutAt,
        total: bookings.total,
        ordersTotal: bookings.ordersTotal,
        method: bookings.paymentMethod,
        shiftId: bookings.shiftId,
        staff: users.fullName,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .leftJoin(users, eq(users.id, bookings.userId))
      .where(gte(bookings.checkedInAt, from))
      .orderBy(desc(bookings.checkedInAt))
      .limit(40),
    db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "shift_handover"))
      .orderBy(desc(auditLogs.createdAt))
      .limit(30),
    db
      .select({ id: shifts.id, openedAt: shifts.openedAt, openingCash: shifts.openingCash, staff: users.fullName })
      .from(shifts)
      .innerJoin(users, eq(users.id, shifts.userId))
      .where(sql`${shifts.closedAt} is null`),
    db.select({ id: users.id, fullName: users.fullName, role: users.role, active: users.active }).from(users).where(inArray(users.role, ["admin", "manager", "employee"])).orderBy(users.fullName),
  ]);

  const moves = (movesRes.rows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      at: new Date(row.at as string),
      kind: row.kind as "in" | "out",
      source: String(row.source),
      detail: (row.detail as string | null) ?? null,
      method: (row.method as string | null) ?? null,
      amount: num(row.amount),
      staff: (row.staff as string | null) ?? null,
      shift_id: row.shift_id == null ? null : Number(row.shift_id),
    } satisfies Move;
  });

  // Totals over the whole range (the list above is capped, totals are not).
  const totalsRes = await db.execute(sql`
    select
      (select coalesce(sum(total),0) from bookings where status='closed' and checked_out_at >= ${from}) as sessions,
      (select coalesce(sum(total),0) from fnb_sales where created_at >= ${from}) as fnb,
      (select coalesce(sum(amount),0) from manual_incomes where created_at >= ${from}) as manual,
      (select coalesce(sum(price_snapshot),0) from customer_subscriptions where status <> 'cancelled' and purchased_at >= ${from}) as packages,
      (select coalesce(sum(amount),0) from expenses where created_at >= ${from}) as expenses
  `);
  const t = (totalsRes.rows?.[0] ?? {}) as Record<string, unknown>;
  const moneyIn = num(t.sessions) + num(t.fnb) + num(t.manual) + num(t.packages);
  const moneyOut = num(t.expenses);

  const nameById = new Map(userRows.map((u) => [u.id, u.fullName]));
  const handoverByShift = new Map<number, { to: string; at: Date; diff: number | null; closing: number | null }>();
  for (const h of handoverRows) {
    if (h.entityId == null) continue;
    const d = (h.details ?? {}) as Record<string, unknown>;
    handoverByShift.set(h.entityId, {
      to: nameById.get(Number(d.toUserId)) ?? "—",
      at: h.createdAt,
      diff: d.difference == null ? null : num(d.difference),
      closing: d.closingCash == null ? null : num(d.closingCash),
    });
  }
  const handoversInRange = handoverRows.filter((h) => h.createdAt >= from);

  const roleLabel: Record<string, string> = { admin: "مالك", manager: "مدير", employee: "موظف" };

  return (
    <div className="x-page space-y-5">
      <div className="x-head">
        <div>
          <h1>لوحة المالك</h1>
          <p>كل الجلسات والفلوس الداخلة والخارجة، ومين فتح كل شيفت وتسليم الشيفتات.</p>
        </div>
        <div className="x-tabs" role="tablist" aria-label="الفترة">
          {Object.entries(RANGES).map(([k, v]) => (
            <Link key={k} href={`/admin?range=${k}`} className={`x-tab ${k === key ? "active" : ""}`}>{v.label}</Link>
          ))}
        </div>
      </div>

      <section className="x-grid x-kpis">
        <div className="x-card x-kpi">
          <div className="x-kpi-top"><span className="x-kpi-label">فلوس داخلة</span><span className="x-kpi-ico tone-green"><Icon name="trending" size={19} /></span></div>
          <div className="x-kpi-value x-num x-in">{arNumber(moneyIn)}<small>ج.م</small></div>
          <div className="x-row-sub">جلسات {arMoney(num(t.sessions))} · بيع مباشر {arMoney(num(t.fnb))}</div>
        </div>
        <div className="x-card x-kpi">
          <div className="x-kpi-top"><span className="x-kpi-label">فلوس خارجة</span><span className="x-kpi-ico tone-red"><Icon name="wallet" size={19} /></span></div>
          <div className="x-kpi-value x-num x-out">{arNumber(moneyOut)}<small>ج.م</small></div>
          <div className="x-row-sub">مصاريف مسجّلة في الفترة</div>
        </div>
        <div className="x-card x-kpi">
          <div className="x-kpi-top"><span className="x-kpi-label">الصافي</span><span className="x-kpi-ico tone-blue"><Icon name="cash" size={19} /></span></div>
          <div className="x-kpi-value x-num">{arNumber(moneyIn - moneyOut)}<small>ج.م</small></div>
          <div className="x-row-sub">باقات {arMoney(num(t.packages))} · يدوي {arMoney(num(t.manual))}</div>
        </div>
        <div className="x-card x-kpi">
          <div className="x-kpi-top"><span className="x-kpi-label">الشيفت الشغال دلوقتي</span><span className="x-kpi-ico tone-violet"><Icon name="clock" size={19} /></span></div>
          {openShiftRows.length === 0 ? (
            <div className="x-kpi-value" style={{ fontSize: 20 }}>مفيش شيفت مفتوح</div>
          ) : (
            openShiftRows.map((s) => (
              <div key={s.id}>
                <div className="x-kpi-value" style={{ fontSize: 20 }}>{s.staff}</div>
                <div className="x-row-sub">فتحه {arTime(s.openedAt, tz)} · كاش افتتاحي {arMoney(Number(s.openingCash))}</div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="x-card">
        <div className="x-card-head"><h2>الشيفتات وتسليمها</h2><span className="x-pill blue">{handoversInRange.length} تسليم في الفترة</span></div>
        {shiftRows.length === 0 ? <div className="x-empty">مفيش شيفتات في الفترة دي.</div> : (
          <div className="x-table-wrap">
            <table className="x-table">
              <thead><tr><th>الشيفت</th><th>فتحه</th><th>من</th><th>إلى</th><th>المدة</th><th>كاش افتتاحي</th><th>كاش الإقفال</th><th>اتسلّم لـ</th><th>فرق الكاش</th><th /></tr></thead>
              <tbody>
                {shiftRows.map((s) => {
                  const h = handoverByShift.get(s.id);
                  return (
                    <tr key={s.id}>
                      <td className="x-num font-bold">#{s.id}</td>
                      <td className="font-bold">{s.staff}</td>
                      <td className="x-num">{arDateTime(s.openedAt, tz)}</td>
                      <td className="x-num">{s.closedAt ? arDateTime(s.closedAt, tz) : <span className="x-pill green">مفتوح</span>}</td>
                      <td className="x-num">{arDuration(s.openedAt, s.closedAt)}</td>
                      <td className="x-num">{arMoney(Number(s.openingCash))}</td>
                      <td className="x-num">{s.closingCash == null ? "—" : arMoney(Number(s.closingCash))}</td>
                      <td>{h ? <span className="x-pill violet">{h.to}</span> : s.closedAt ? <span className="x-pill">اتقفل من غير تسليم</span> : "—"}</td>
                      <td className="x-num">{h && h.diff != null ? (h.diff === 0 ? <span className="x-pill green">مظبوط</span> : <span className={`x-pill ${h.diff < 0 ? "red" : "amber"}`} dir="ltr">{h.diff > 0 ? "+" : ""}{arNumber(h.diff)}</span>) : "—"}</td>
                      <td><Link href={`/shift/summary/${s.id}`} className="x-link">ملخص</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="x-grid x-cols-2">
        <section className="x-card">
          <div className="x-card-head"><h2>حركة الفلوس</h2><span className="x-row-sub">آخر {moves.length} حركة</span></div>
          {moves.length === 0 ? <div className="x-empty">مفيش حركات في الفترة دي.</div> : (
            <div className="x-table-wrap">
              <table className="x-table">
                <thead><tr><th>الوقت</th><th>النوع</th><th>التفاصيل</th><th>الدفع</th><th>الموظف</th><th>المبلغ</th></tr></thead>
                <tbody>
                  {moves.map((m, i) => (
                    <tr key={i}>
                      <td className="x-num" style={{ whiteSpace: "nowrap" }}>{arDate(m.at, tz)} · {arTime(m.at, tz)}</td>
                      <td><span className={`x-pill ${m.kind === "in" ? "green" : "red"}`}>{m.source}</span></td>
                      <td className="truncate" style={{ maxWidth: 200 }}>{m.detail || "—"}</td>
                      <td>{paymentLabel(m.method)}</td>
                      <td>{m.staff ?? "—"}{m.shift_id ? <span className="x-row-sub x-num"> · ش#{m.shift_id}</span> : null}</td>
                      <td className={`x-num ${m.kind === "in" ? "x-in" : "x-out"}`} dir="ltr" style={{ textAlign: "start" }}>{m.kind === "in" ? "+" : "−"}{arNumber(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="space-y-4">
          <section className="x-card">
            <div className="x-card-head"><h2>تحكم كامل</h2></div>
            <div className="x-list">
              {[
                { href: "/settings/shifts", label: "الموظفين والشيفتات", sub: "مين على الشيفت وحسابات الموظفين" },
                { href: "/settings", label: "الإعدادات والحسابات", sub: "المستخدمين، الأسعار، الطباعة، جوجل" },
                { href: "/expenses", label: "المصاريف والإيرادات", sub: "سجّل أو راجع الحركات" },
                { href: "/reports", label: "التقارير", sub: "تحليل كامل للإيراد والمصاريف" },
                { href: "/bank", label: "البنك", sub: "إيداع وسحب" },
              ].map((l) => (
                <Link key={l.href} href={l.href} className="x-row" style={{ textDecoration: "none" }}>
                  <div className="x-row-main"><div className="x-row-title">{l.label}</div><div className="x-row-sub">{l.sub}</div></div>
                  <span aria-hidden="true">←</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="x-card">
            <div className="x-card-head"><h2>الفريق</h2></div>
            <div className="x-list">
              {userRows.map((u) => (
                <div key={u.id} className="x-row">
                  <span className="x-avatar" style={{ width: 32, height: 32, borderRadius: 10, fontSize: 13 }}>{u.fullName.charAt(0)}</span>
                  <div className="x-row-main x-row-title">{u.fullName}</div>
                  <span className="x-pill">{roleLabel[u.role] ?? u.role}</span>
                  {!u.active && <span className="x-pill red">موقوف</span>}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="x-card">
        <div className="x-card-head"><h2>كل الجلسات</h2><span className="x-row-sub">آخر {sessionRows.length} جلسة في الفترة</span></div>
        {sessionRows.length === 0 ? <div className="x-empty">مفيش جلسات في الفترة دي.</div> : (
          <div className="x-table-wrap">
            <table className="x-table">
              <thead><tr><th>العميل</th><th>دخل</th><th>خرج</th><th>المدة</th><th>فتحها</th><th>الكافيه</th><th>الدفع</th><th>الإجمالي</th></tr></thead>
              <tbody>
                {sessionRows.map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/bookings/${b.id}`} className="font-bold" style={{ color: "inherit" }}>{b.customer}</Link></td>
                    <td className="x-num">{b.checkedInAt ? arDate(b.checkedInAt, tz) + " · " + arTime(b.checkedInAt, tz) : "—"}</td>
                    <td className="x-num">{b.status === "active" ? <span className="x-pill green">شغالة</span> : b.checkedOutAt ? arTime(b.checkedOutAt, tz) : "—"}</td>
                    <td className="x-num">{b.checkedInAt ? arDuration(b.checkedInAt, b.checkedOutAt) : "—"}</td>
                    <td>{b.staff ?? "—"}<span className="x-row-sub x-num"> · ش#{b.shiftId}</span></td>
                    <td className="x-num">{arMoney(Number(b.ordersTotal ?? 0))}</td>
                    <td>{b.status === "active" ? "—" : paymentLabel(b.method)}</td>
                    <td className="font-bold x-num">{b.status === "active" ? "—" : arMoney(Number(b.total ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
