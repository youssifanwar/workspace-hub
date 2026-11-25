"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFmt } from "@/lib/lang-context";

export default function StatementTools(props: {
  mode: "add" | "remove" | "print";
  companyId: number;
  customerId?: number;
  customers?: Array<{ id: number; name: string }>;
  canManage: boolean;
}) {
  const f = useFmt();
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function post(body: unknown) {
    setBusy(true); setErr("");
    const res = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) { setErr(f.en ? "Could not save." : "معرفناش نحفظ."); return; }
    router.refresh();
  }

  if (props.mode === "print") {
    return <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>{f.en ? "Print statement" : "اطبع الكشف"}</button>;
  }
  if (!props.canManage) return null;
  if (props.mode === "remove") {
    return <button className="btn btn-ghost no-print" disabled={busy} onClick={() => post({ action: "remove_member", companyId: props.companyId, customerId: props.customerId })}>{f.en ? "Remove" : "شيل"}</button>;
  }
  return (
    <div className="v2-toolbar no-print">
      <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">{f.en ? "Add a customer…" : "ضيف عميل…"}</option>
        {(props.customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button className="btn btn-primary" disabled={busy || !pick} onClick={() => post({ action: "add_member", companyId: props.companyId, customerId: Number(pick) }).then(() => setPick(""))}>{f.en ? "Add" : "إضافة"}</button>
      {err && <span style={{ color: "#b91c1c" }}>{err}</span>}
    </div>
  );
}
