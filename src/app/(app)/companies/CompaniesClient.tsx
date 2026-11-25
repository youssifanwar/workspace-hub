"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFmt } from "@/lib/lang-context";
import { Panel } from "../_components/ui";

type Comp = { id: number; name: string; members: number; balance: number };
type Guest = { id: number; host: string; guest: string; phone: string; date: string };

export default function CompaniesClient({
  companies, guests, customers, canManage,
}: { companies: Comp[]; guests: Guest[]; customers: Array<{ id: number; name: string }>; canManage: boolean }) {
  const f = useFmt();
  const router = useRouter();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [guest, setGuest] = useState("");
  const [gphone, setGphone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(body: unknown): Promise<boolean> {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) { setMsg({ ok: false, text: f.t(d?.error || "Failed.") }); return false; }
      setMsg({ ok: true, text: "✓" });
      router.refresh();
      return true;
    } catch {
      setMsg({ ok: false, text: f.en ? "No connection." : "مفيش اتصال." });
      return false;
    } finally { setBusy(false); }
  }

  return (
    <>
      {msg && <div className={`v2-alert ${msg.ok ? "green" : "red"}`}>{msg.text}</div>}
      <Panel title={f.en ? "Companies" : "الشركات"} flush>
        {canManage && (
          <div className="v2-toolbar">
            <input className="input" placeholder={f.en ? "New company name" : "اسم شركة جديدة"} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={async () => { if (await call({ action: "create_company", name })) setName(""); }}>{f.en ? "Add company" : "إضافة شركة"}</button>
          </div>
        )}
        {companies.length === 0 ? <p style={{ padding: 20 }}>{f.en ? "No companies yet." : "مفيش شركات لسه."}</p> : (
          <div className="x-table-wrap"><table className="v2-tbl">
            <thead><tr><th>{f.en ? "Company" : "الشركة"}</th><th>{f.en ? "Members" : "الأعضاء"}</th><th>{f.en ? "Combined balance" : "إجمالي الأرصدة"}</th><th /></tr></thead>
            <tbody>{companies.map((c) => (
              <tr key={c.id}><td>{c.name}</td><td>{c.members}</td><td>{f.money(c.balance)}</td>
                <td><Link className="btn btn-ghost" href={`/companies/${c.id}`}>{f.en ? "Open statement" : "كشف الحساب"}</Link></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>

      <Panel title={f.en ? "Guest visits" : "زوار"} flush>
        <div className="v2-toolbar">
          <select className="input" value={host} onChange={(e) => setHost(e.target.value)}>
            <option value="">{f.en ? "Host customer…" : "العميل المضيف…"}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className="input" placeholder={f.en ? "Guest name" : "اسم الزائر"} value={guest} onChange={(e) => setGuest(e.target.value)} />
          <input className="input" placeholder={f.en ? "Phone (optional)" : "التليفون"} value={gphone} onChange={(e) => setGphone(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !host || !guest.trim()} onClick={async () => { if (await call({ action: "add_guest", hostCustomerId: Number(host), guestName: guest, guestPhone: gphone })) { setGuest(""); setGphone(""); } }}>{f.en ? "Log guest" : "سجّل زائر"}</button>
        </div>
        {guests.length === 0 ? <p style={{ padding: 20 }}>{f.en ? "No guests logged." : "مفيش زوار متسجلين."}</p> : (
          <div className="x-table-wrap"><table className="v2-tbl">
            <thead><tr><th>{f.en ? "Date" : "التاريخ"}</th><th>{f.en ? "Guest" : "الزائر"}</th><th>{f.en ? "Host" : "المضيف"}</th><th>{f.en ? "Phone" : "التليفون"}</th><th /></tr></thead>
            <tbody>{guests.map((g) => (
              <tr key={g.id}><td>{g.date}</td><td>{g.guest}</td><td>{g.host}</td><td>{g.phone}</td>
                <td>{canManage && <button className="btn btn-ghost" disabled={busy} onClick={() => call({ action: "delete_guest", id: g.id })}>{f.en ? "Delete" : "حذف"}</button>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
