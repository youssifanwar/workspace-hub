"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFmt } from "@/lib/lang-context";
import { Panel } from "../_components/ui";

type Row = { id: number; customerId: number; customerName: string; planName: string; price: number; status: string; next: string; last: string };

export default function MembershipsClient({
  rows, customers, canManage,
}: { rows: Row[]; customers: Array<{ id: number; name: string }>; canManage: boolean }) {
  const f = useFmt();
  const router = useRouter();
  const [cid, setCid] = useState("");
  const [plan, setPlan] = useState("");
  const [price, setPrice] = useState("");
  const [first, setFirst] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function call(url: string, method: string, body: unknown, okText: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) { setMsg({ ok: false, text: f.t(d?.error || "Failed.") }); return; }
      setMsg({ ok: true, text: okText });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: f.en ? "No connection." : "مفيش اتصال." });
    } finally { setBusy(false); }
  }

  const statusAr: Record<string, string> = { active: "نشط", paused: "موقوف", cancelled: "ملغي" };

  return (
    <>
      {canManage && (
        <Panel title={f.en ? "New membership" : "اشتراك جديد"}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <select className="input" value={cid} onChange={(e) => setCid(e.target.value)}>
              <option value="">{f.en ? "Customer…" : "العميل…"}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className="input" placeholder={f.en ? "Plan name" : "اسم الخطة"} value={plan} onChange={(e) => setPlan(e.target.value)} />
            <input className="input" type="number" min={1} placeholder={f.en ? "Monthly price" : "السعر الشهري"} value={price} onChange={(e) => setPrice(e.target.value)} />
            <input className="input" type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
            <button className="btn btn-primary" disabled={busy || !cid || !plan.trim() || !(Number(price) > 0)}
              onClick={() => call("/api/memberships", "POST", { customerId: Number(cid), planName: plan, monthlyPrice: Number(price), firstBillingDate: first }, f.en ? "Created ✓" : "اتعمل ✓").then(() => { setPlan(""); setPrice(""); })}>
              {f.en ? "Add" : "إضافة"}
            </button>
          </div>
        </Panel>
      )}
      {msg && <div className={`v2-alert ${msg.ok ? "green" : "red"}`}>{msg.text}</div>}
      <Panel flush title={f.en ? "Memberships" : "الاشتراكات"}>
        {rows.length === 0 ? (
          <p style={{ padding: 20 }}>{f.en ? "No memberships yet." : "مفيش اشتراكات لسه."}</p>
        ) : (
          <div className="x-table-wrap"><table className="v2-tbl">
            <thead><tr>
              <th>{f.en ? "Customer" : "العميل"}</th><th>{f.en ? "Plan" : "الخطة"}</th><th>{f.en ? "Price" : "السعر"}</th>
              <th>{f.en ? "Status" : "الحالة"}</th><th>{f.en ? "Next billing" : "التحصيل الجاي"}</th><th />
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const due = r.status === "active" && r.next <= today;
                return (
                  <tr key={r.id}>
                    <td>{r.customerName}</td><td>{r.planName}</td><td>{f.money(r.price)}</td>
                    <td><span className={`v2-tag ${r.status === "active" ? "green" : "amber"}`}>{f.en ? r.status : statusAr[r.status] ?? r.status}</span></td>
                    <td>{r.next}{due ? (f.en ? " · due" : " · مستحق") : ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {canManage && r.status !== "cancelled" && (
                        <>
                          {due && <button className="btn btn-primary" disabled={busy} onClick={() => { if (confirm(f.en ? `Charge ${r.price} to ${r.customerName}'s balance?` : `تخصم ${r.price} من رصيد ${r.customerName}؟`)) call(`/api/memberships/${r.id}`, "PATCH", { action: "charge" }, f.en ? "Charged ✓" : "اتحصّل ✓"); }}>{f.en ? "Charge" : "حصّل"}</button>}{" "}
                          {r.status === "active"
                            ? <button className="btn btn-ghost" disabled={busy} onClick={() => call(`/api/memberships/${r.id}`, "PATCH", { action: "pause" }, "✓")}>{f.en ? "Pause" : "إيقاف"}</button>
                            : <button className="btn btn-ghost" disabled={busy} onClick={() => call(`/api/memberships/${r.id}`, "PATCH", { action: "resume" }, "✓")}>{f.en ? "Resume" : "استئناف"}</button>}{" "}
                          <button className="btn btn-ghost" disabled={busy} onClick={() => { if (confirm(f.en ? "Cancel this membership?" : "تلغي الاشتراك؟")) call(`/api/memberships/${r.id}`, "PATCH", { action: "cancel" }, "✓"); }}>{f.en ? "Cancel" : "إلغاء"}</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
