import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { getAllSettings, formatMoney } from "@/lib/settings";
import PrintButton from "@/app/(app)/shift/summary/[id]/PrintButton";

export const dynamic = "force-dynamic";

function safeNumber(value: unknown, fallback = 0): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeMoney(value: unknown): number {
  return Math.round(safeNumber(value, 0) * 100) / 100;
}

function formatDateTime(value: unknown): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

export default async function FnbInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const saleId = Number(id);

  if (!Number.isSafeInteger(saleId) || saleId <= 0) {
    notFound();
  }

  const [saleResult, itemResult, settings] = await Promise.all([
    db.execute(sql`
      SELECT
        s.id,
        s.shift_id,
        s.user_id,
        s.subtotal,
        s.discount,
        s.total,
        s.paid_amount,
        s.change_amount,
        s.payment_method,
        s.note,
        s.created_at,
        u.full_name AS cashier_name
      FROM fnb_sales s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.id = ${saleId}
      LIMIT 1
    `),
    db.execute(sql`
      SELECT
        id,
        product_id,
        name_snapshot,
        unit_price,
        quantity,
        item_note
      FROM fnb_sale_items
      WHERE sale_id = ${saleId}
      ORDER BY id ASC
    `),
    getAllSettings(),
  ]);

  const sale = saleResult.rows?.[0] as
    | Record<string, unknown>
    | undefined;

  if (!sale) notFound();

  const items = (itemResult.rows ?? []) as Array<Record<string, unknown>>;
  const subtotal = safeMoney(sale.subtotal);
  const discount = safeMoney(sale.discount);
  const total = safeMoney(sale.total);
  const paidAmount = safeMoney(sale.paid_amount);
  const changeAmount = safeMoney(sale.change_amount);
  const currency = settings.currency?.trim() || "EGP";
  const workspaceName = settings.workspace_name?.trim() || "WorkSpace Hub";
  const workspaceAddress = settings.workspace_address?.trim() || "";
  const workspacePhone = settings.workspace_phone?.trim() || "";
  const invoiceFooter = settings.invoice_footer?.trim() || "";
  const cashierName = String(sale.cashier_name ?? "-").trim() || "-";
  const paymentMethod = String(sale.payment_method ?? "-").trim() || "-";
  const note = String(sale.note ?? "").trim();

  const itemSubtotal = items.reduce(
    (sum, item) =>
      sum + safeMoney(item.unit_price) * Math.max(0, Math.trunc(safeNumber(item.quantity, 0))),
    0,
  );

  // Database total is authoritative; this reconciliation is only diagnostic/UI safety.
  const reconciledTotal = Math.round((subtotal - discount) * 100) / 100;

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="no-print flex items-center justify-between gap-2">
          <Link href="/fnb" className="btn btn-ghost">
            ← F&B
          </Link>
          <PrintButton />
        </div>

        <div className="card p-6 space-y-4 font-mono text-sm" id="invoice">
          <div className="text-center border-b border-dashed border-slate-300 pb-3">
            <div className="text-3xl mb-1" aria-hidden="true">🏢</div>
            <div className="text-lg font-bold">{workspaceName}</div>
            {workspaceAddress && <div className="text-xs text-slate-500">{workspaceAddress}</div>}
            {workspacePhone && <div className="text-xs text-slate-500">📞 {workspacePhone}</div>}
          </div>

          <div className="text-xs space-y-1">
            <Line label="Invoice #" value={`FNB-${String(sale.id).padStart(6, "0")}`} />
            <Line label="Date" value={formatDateTime(sale.created_at)} />
            <Line label="Cashier" value={cashierName} />
            <Line label="Customer" value="Walk-in Customer" />
            <Line label="Shift" value={`#${String(sale.shift_id)}`} />
          </div>

          <div className="border-t border-b border-dashed border-slate-300 py-3">
            <div className="text-xs font-bold mb-2">F&amp;B ITEMS</div>
            {items.length === 0 ? (
              <div className="text-xs text-slate-500">No items recorded.</div>
            ) : (
              items.map((item, index) => {
                const quantity = Math.max(0, Math.trunc(safeNumber(item.quantity, 0)));
                const unitPrice = safeMoney(item.unit_price);
                const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
                return (
                  <div key={`${String(item.id ?? index)}`} className="flex items-start justify-between text-xs py-0.5 gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="break-words">{String(item.name_snapshot ?? "Unnamed item")}</div>
                      <div className="text-[10px] text-slate-500">
                        {unitPrice.toFixed(2)} × {quantity}
                      </div>
                      {String(item.item_note ?? "").trim() && (
                        <div className="text-[10px] text-slate-400">Note: {String(item.item_note).trim()}</div>
                      )}
                    </div>
                    <div className="font-bold tabular-nums shrink-0">{lineTotal.toFixed(2)}</div>
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-1 text-xs">
            <Line label="Subtotal" value={formatMoney(subtotal, currency)} />
            {discount > 0 && (
              <Line label="Discount" value={`- ${formatMoney(discount, currency)}`} />
            )}
            <div className="flex items-center justify-between text-lg font-bold pt-2 border-t border-slate-300">
              <span>TOTAL</span>
              <span className="tabular-nums">{formatMoney(total, currency)}</span>
            </div>
          </div>

          <div className="border-t border-dashed border-slate-300 pt-3 space-y-1 text-xs">
            <Line label="Payment" value={paymentMethod.toUpperCase()} />
            <Line label="Paid" value={formatMoney(paidAmount, currency)} />
            <Line label="Change" value={formatMoney(changeAmount, currency)} />
          </div>

          {note && (
            <div className="text-xs border-t border-dashed border-slate-300 pt-3">
              <div className="font-bold">Note</div>
              <div className="text-slate-500 whitespace-pre-wrap mt-1">{note}</div>
            </div>
          )}

          {(Math.abs(itemSubtotal - subtotal) > 0.01 || Math.abs(reconciledTotal - total) > 0.01) && (
            <div className="text-[10px] text-amber-700 border border-amber-200 bg-amber-50 rounded-xl p-2">
              Stored sale totals differ slightly from item-line totals. The invoice uses the stored sale total as the accounting source of truth.
            </div>
          )}

          {invoiceFooter && (
            <div className="text-center pt-3 border-t border-dashed border-slate-300">
              <div className="text-xs text-slate-500 whitespace-pre-wrap">{invoiceFooter}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-right break-words">{value}</span>
    </div>
  );
}
