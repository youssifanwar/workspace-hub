import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { companies, customers } from "@/db/schema";
import { getCurrentUser, canManage } from "@/lib/auth";
import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";
import { getSetting } from "@/lib/settings";
import { loadTimezone } from "@/lib/timezone";
import { PageBar, Panel } from "../../_components/ui";
import StatementTools from "./StatementTools";

export const dynamic = "force-dynamic";

export default async function CompanyStatement({ params }: { params: Promise<{ id: string }> }) {
  const f = makeFmt(await getLang());
  const user = await getCurrentUser();
  await loadTimezone();
  if (!user) redirect("/login");
  if ((await getSetting("feature_companies")) !== "1") redirect("/companies");
  const cid = Number((await params).id);
  if (!Number.isSafeInteger(cid) || cid <= 0) notFound();

  let company: { id: number; name: string } | undefined;
  let members: Array<{ id: number; name: string; balance: number }> = [];
  let ledger: Array<{ at: string; name: string; type: string; amount: number; note: string }> = [];
  let allCustomers: Array<{ id: number; name: string }> = [];
  try {
    [company] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, cid)).limit(1);
    if (!company) notFound();
    const m = await db.execute(sql`
      select cu.id, cu.name, cu.balance::float as balance
      from company_members cm join customers cu on cu.id = cm.customer_id
      where cm.company_id = ${cid} order by cu.name`);
    members = (m as unknown as { rows: typeof members }).rows.map((x) => ({ ...x, balance: Number(x.balance) }));
    const l = await db.execute(sql`
      select t.created_at as at, cu.name, t.type, t.amount::float as amount, coalesce(t.note,'') as note
      from customer_balance_transactions t
      join company_members cm on cm.customer_id = t.customer_id and cm.company_id = ${cid}
      join customers cu on cu.id = t.customer_id
      where t.created_at >= now() - interval '90 days'
      order by t.created_at desc limit 200`);
    ledger = (l as unknown as { rows: Array<{ at: Date | string; name: string; type: string; amount: number; note: string }> }).rows.map((x) => ({
      at: f.dateTime(new Date(x.at)), name: x.name, type: x.type, amount: Number(x.amount), note: x.note,
    }));
    allCustomers = await db.select({ id: customers.id, name: customers.name }).from(customers).orderBy(asc(customers.name)).limit(1000);
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_")) throw e;
    redirect("/companies");
  }
  const total = members.reduce((s, x) => s + x.balance, 0);
  const typeAr: Record<string, string> = { deposit: "إيداع", payment: "دفع", refund: "استرداد", adjustment: "تعديل" };

  return (
    <div>
      <PageBar
        crumb={f.en ? "Company statement" : "كشف حساب شركة"}
        title={company!.name}
        description={f.en ? "Members and their balance activity in the last 90 days. Negative = owed." : "الأعضاء وحركة أرصدتهم آخر 90 يوم. السالب = مستحق."}
        actions={<Link href="/companies" className="btn btn-ghost no-print">{f.en ? "Back" : "رجوع"}</Link>}
      />
      <Panel title={f.en ? "Members" : "الأعضاء"} meta={`${f.en ? "Combined" : "الإجمالي"}: ${f.money(total)}`} flush>
        <div className="x-table-wrap"><table className="v2-tbl">
          <thead><tr><th>{f.en ? "Customer" : "العميل"}</th><th>{f.en ? "Balance" : "الرصيد"}</th><th /></tr></thead>
          <tbody>
            {members.length === 0 ? <tr><td colSpan={3} className="v2-empty">{f.en ? "No members yet." : "مفيش أعضاء لسه."}</td></tr> : members.map((x) => (
              <tr key={x.id}><td>{x.name}</td><td>{f.money(x.balance)}</td>
                <td><StatementTools mode="remove" companyId={cid} customerId={x.id} canManage={canManage(user.role)} /></td></tr>
            ))}
          </tbody>
        </table></div>
        <StatementTools mode="add" companyId={cid} customers={allCustomers.filter((c) => !members.some((m) => m.id === c.id))} canManage={canManage(user.role)} />
      </Panel>
      <Panel title={f.en ? "Activity (90 days)" : "الحركة (90 يوم)"} flush>
        <div className="x-table-wrap"><table className="v2-tbl">
          <thead><tr><th>{f.en ? "When" : "الوقت"}</th><th>{f.en ? "Customer" : "العميل"}</th><th>{f.en ? "Type" : "النوع"}</th><th>{f.en ? "Amount" : "المبلغ"}</th><th>{f.en ? "Note" : "ملاحظة"}</th></tr></thead>
          <tbody>
            {ledger.length === 0 ? <tr><td colSpan={5} className="v2-empty">{f.en ? "No activity." : "مفيش حركة."}</td></tr> : ledger.map((x, i) => (
              <tr key={i}><td>{x.at}</td><td>{x.name}</td><td>{f.en ? x.type : typeAr[x.type] ?? x.type}</td><td>{f.money(x.amount)}</td><td>{x.note}</td></tr>
            ))}
          </tbody>
        </table></div>
      </Panel>
      <StatementTools mode="print" companyId={cid} canManage={false} />
    </div>
  );
}
