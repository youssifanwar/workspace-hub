import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { companies, customers, guestPasses } from "@/db/schema";
import { getCurrentUser, canManage } from "@/lib/auth";
import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";
import { getSetting } from "@/lib/settings";
import { loadTimezone } from "@/lib/timezone";
import { PageBar, Panel } from "../_components/ui";
import CompaniesClient from "./CompaniesClient";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const f = makeFmt(await getLang());
  const user = await getCurrentUser();
  await loadTimezone();
  if (!user) redirect("/login");
  const on = (await getSetting("feature_companies")) === "1";

  let missing = false;
  let comps: Array<{ id: number; name: string; members: number; balance: number }> = [];
  let guests: Array<{ id: number; host: string; guest: string; phone: string; date: string }> = [];
  let custs: Array<{ id: number; name: string }> = [];
  if (on) {
    try {
      const r = await db.execute(sql`
        select c.id, c.name,
          (select count(*)::int from company_members m where m.company_id = c.id) as members,
          coalesce((select sum(cu.balance) from company_members m join customers cu on cu.id = m.customer_id where m.company_id = c.id), 0)::float as balance
        from companies c where c.active order by c.name`);
      comps = (r as unknown as { rows: typeof comps }).rows.map((x) => ({ ...x, balance: Number(x.balance) }));
      const g = await db
        .select({ id: guestPasses.id, host: customers.name, guest: guestPasses.guestName, phone: guestPasses.guestPhone, date: guestPasses.visitDate })
        .from(guestPasses)
        .innerJoin(customers, eq(customers.id, guestPasses.hostCustomerId))
        .orderBy(desc(guestPasses.id))
        .limit(30);
      guests = g.map((x) => ({ id: x.id, host: x.host, guest: x.guest, phone: x.phone ?? "", date: String(x.date) }));
      custs = await db.select({ id: customers.id, name: customers.name }).from(customers).orderBy(asc(customers.name)).limit(1000);
    } catch {
      missing = true;
    }
  }

  return (
    <div>
      <PageBar
        crumb={f.en ? "Customers" : "العملاء"}
        title={f.en ? "Companies and guests" : "الشركات والزوار"}
        description={f.en ? "Group customers under a company with one combined statement, and log guests." : "اجمع العملاء تحت شركة بكشف حساب واحد، وسجّل الزوار."}
        actions={<Link href="/customers" className="btn btn-ghost">{f.en ? "Back to customers" : "رجوع للعملاء"}</Link>}
      />
      {!on ? (
        <Panel><p>{f.en ? "This feature is off. Run optional-migrations/003_companies_and_guests.sql, then turn it on in Settings." : "الميزة دي مقفولة. شغّل optional-migrations/003_companies_and_guests.sql وبعدين فعّلها من الإعدادات."}</p></Panel>
      ) : missing ? (
        <div className="v2-alert red">{f.en ? "The tables do not exist yet. Run optional-migrations/003_companies_and_guests.sql (see README there)." : "الجداول لسه مش موجودة. شغّل optional-migrations/003 (التفاصيل في README)."}</div>
      ) : (
        <CompaniesClient canManage={canManage(user.role)} companies={comps} guests={guests} customers={custs} />
      )}
    </div>
  );
}
