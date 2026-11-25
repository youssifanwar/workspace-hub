import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { customerBalanceTransactions, customers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";
import { getAllSettings } from "@/lib/settings";
import { loadTimezone } from "@/lib/timezone";
import PrintButton from "@/app/(app)/shift/summary/[id]/PrintButton";

export const dynamic = "force-dynamic";

/** Printable receipt for one balance movement (top-up, payment, refund, adjustment). */
export default async function BalanceReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const f = makeFmt(await getLang());
  const user = await getCurrentUser();
  await loadTimezone();
  if (!user) redirect("/login");
  const txId = Number((await params).id);
  if (!Number.isSafeInteger(txId) || txId <= 0) notFound();

  const [row] = await db
    .select({
      id: customerBalanceTransactions.id,
      type: customerBalanceTransactions.type,
      amount: customerBalanceTransactions.amount,
      balanceAfter: customerBalanceTransactions.balanceAfter,
      method: customerBalanceTransactions.paymentMethod,
      note: customerBalanceTransactions.note,
      at: customerBalanceTransactions.createdAt,
      customer: customers.name,
      phone: customers.phone,
    })
    .from(customerBalanceTransactions)
    .innerJoin(customers, eq(customers.id, customerBalanceTransactions.customerId))
    .where(eq(customerBalanceTransactions.id, txId))
    .limit(1);
  if (!row) notFound();

  const settings = await getAllSettings();
  const name = settings.workspace_name?.trim() || "WorkSpace Hub";
  const typeLabel: Record<string, [string, string]> = {
    deposit: ["Top-up receipt", "إيصال شحن رصيد"],
    payment: ["Payment from balance", "دفع من الرصيد"],
    refund: ["Refund to balance", "استرداد للرصيد"],
    adjustment: ["Balance adjustment", "تعديل رصيد"],
  };
  const title = typeLabel[row.type]?.[f.en ? 0 : 1] ?? row.type;
  const amount = Number(row.amount);
  const after = Number(row.balanceAfter);

  const Line = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between gap-3"><span className="text-slate-500">{k}</span><span className="font-semibold">{v}</span></div>
  );

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="no-print flex items-center justify-between gap-2">
          <Link href="/customers" className="btn btn-ghost">{f.en ? "← Customers" : "← العملاء"}</Link>
          <PrintButton />
        </div>
        <div className="card p-6 space-y-4 text-sm" id="invoice">
          <div className="text-center border-b border-dashed border-slate-300 pb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/scope-logo-brown.png" alt="" width={981} height={558} style={{ height: 56, width: "auto", margin: "0 auto 6px" }} />
            <div className="text-lg font-bold">{name}</div>
            {settings.workspace_address && <div className="text-xs text-slate-500">{settings.workspace_address}</div>}
            {settings.workspace_phone && <div className="text-xs text-slate-500">{settings.workspace_phone}</div>}
          </div>
          <div className="text-center font-bold">{title}</div>
          <div className="space-y-2">
            <Line k={f.en ? "Receipt #" : "رقم الإيصال"} v={`BAL-${String(row.id).padStart(6, "0")}`} />
            <Line k={f.en ? "Date" : "التاريخ"} v={f.dateTime(row.at)} />
            <Line k={f.en ? "Customer" : "العميل"} v={row.customer} />
            {row.method && <Line k={f.en ? "Method" : "طريقة الدفع"} v={f.t(row.method)} />}
            {row.note && <Line k={f.en ? "Note" : "ملاحظة"} v={row.note} />}
          </div>
          <div className="border-t border-dashed border-slate-300 pt-3 space-y-2">
            <Line k={f.en ? "Amount" : "المبلغ"} v={f.money(amount)} />
            <Line k={f.en ? "Balance after" : "الرصيد بعد العملية"} v={f.money(after)} />
          </div>
          {settings.invoice_footer && <div className="text-center text-xs text-slate-500 border-t border-dashed border-slate-300 pt-3">{settings.invoice_footer}</div>}
        </div>
      </div>
    </div>
  );
}
