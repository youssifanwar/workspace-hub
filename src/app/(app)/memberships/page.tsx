import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { customers, memberships } from "@/db/schema";
import { getCurrentUser, canManage } from "@/lib/auth";
import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";
import { getSetting } from "@/lib/settings";
import { loadTimezone } from "@/lib/timezone";
import { PageBar, Panel } from "../_components/ui";
import MembershipsClient from "./MembershipsClient";

export const dynamic = "force-dynamic";

export default async function MembershipsPage() {
  const f = makeFmt(await getLang());
  const user = await getCurrentUser();
  await loadTimezone();
  if (!user) redirect("/login");
  const on = (await getSetting("feature_memberships")) === "1";

  let rows: Array<{
    id: number; customerId: number; customerName: string; planName: string;
    monthlyPrice: string; status: string; nextBillingDate: string; lastChargedAt: Date | null;
  }> = [];
  let missingTable = false;
  let custs: Array<{ id: number; name: string }> = [];
  if (on) {
    try {
      rows = await db
        .select({
          id: memberships.id, customerId: memberships.customerId, customerName: customers.name,
          planName: memberships.planName, monthlyPrice: memberships.monthlyPrice, status: memberships.status,
          nextBillingDate: memberships.nextBillingDate, lastChargedAt: memberships.lastChargedAt,
        })
        .from(memberships)
        .innerJoin(customers, eq(customers.id, memberships.customerId))
        .orderBy(desc(memberships.id))
        .limit(300);
      custs = await db.select({ id: customers.id, name: customers.name }).from(customers).orderBy(asc(customers.name)).limit(1000);
    } catch {
      missingTable = true;
    }
  }

  return (
    <div>
      <PageBar
        crumb={f.en ? "Customers" : "العملاء"}
        title={f.en ? "Monthly memberships" : "الاشتراكات الشهرية"}
        description={f.en ? "Recurring monthly plans. Charging takes the price from the customer's balance." : "خطط شهرية متكررة. التحصيل بيخصم السعر من رصيد العميل."}
        actions={<Link href="/customers" className="btn btn-ghost">{f.en ? "Back to customers" : "رجوع للعملاء"}</Link>}
      />
      {!on ? (
        <Panel>
          <p>{f.en ? "This feature is off. Turn it on in Settings after running optional-migrations/001_memberships.sql." : "الميزة دي مقفولة. فعّلها من الإعدادات بعد ما تشغّل ملف optional-migrations/001_memberships.sql."}</p>
        </Panel>
      ) : missingTable ? (
        <div className="v2-alert red">{f.en ? "The memberships table does not exist yet. Run optional-migrations/001_memberships.sql (see README there)." : "جدول الاشتراكات لسه مش موجود. شغّل optional-migrations/001_memberships.sql (التفاصيل في README)."}</div>
      ) : (
        <MembershipsClient
          canManage={canManage(user.role)}
          customers={custs}
          rows={rows.map((r) => ({
            id: r.id, customerId: r.customerId, customerName: r.customerName, planName: r.planName,
            price: Number(r.monthlyPrice), status: r.status, next: String(r.nextBillingDate),
            last: r.lastChargedAt ? f.dateTime(r.lastChargedAt) : "",
          }))}
        />
      )}
    </div>
  );
}
