"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function WorkspaceSettings({
  workspaceName,
  workspaceAddress,
  workspacePhone,
  currency,
  invoiceFooter,
}: {
  workspaceName: string;
  workspaceAddress: string;
  workspacePhone: string;
  currency: string;
  invoiceFooter: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(workspaceName);
  const [address, setAddress] = useState(workspaceAddress);
  const [phone, setPhone] = useState(workspacePhone);
  const [cur, setCur] = useState(currency);
  const [footer, setFooter] = useState(invoiceFooter);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_name: name,
        workspace_address: address,
        workspace_phone: phone,
        currency: cur,
        invoice_footer: footer,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setMsg({ type: "err", text: data.error || "Failed" });
      return;
    }
    setMsg({ type: "ok", text: "Saved ✓" });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label">Workspace name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Phone</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="label">Currency</label>
          <input className="input" value={cur} onChange={(e) => setCur(e.target.value)} maxLength={5} />
        </div>
      </div>
      <div>
        <label className="label">Address</label>
        <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div>
        <label className="label">Invoice footer</label>
        <input className="input" value={footer} onChange={(e) => setFooter(e.target.value)} />
      </div>

      {msg && (
        <div className={`p-3 rounded-xl text-sm ${msg.type === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {msg.text}
        </div>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={loading}>
        {loading ? "Saving…" : "Save workspace settings"}
      </button>
    </form>
  );
}
