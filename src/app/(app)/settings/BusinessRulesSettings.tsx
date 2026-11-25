"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFmt } from "@/lib/lang-context";

const PRESETS = [
  { name: "Scope brown", ar: "بني سكوب", color: "#4f2f1a" },
  { name: "Indigo", ar: "نيلي", color: "#4f46e5" },
  { name: "Teal", ar: "أخضر مزرق", color: "#0f766e" },
  { name: "Slate", ar: "رمادي غامق", color: "#334155" },
];

export default function BusinessRulesSettings({
  qrMaxPending,
  packageMaxHours,
  staffMaxDiscount,
  brandColor,
  memberships,
}: {
  qrMaxPending: string;
  packageMaxHours: string;
  staffMaxDiscount: string;
  brandColor: string;
  memberships: string;
}) {
  const f = useFmt();
  const router = useRouter();
  const [qr, setQr] = useState(qrMaxPending);
  const [pkgCap, setPkgCap] = useState(packageMaxHours);
  const [disc, setDisc] = useState(staffMaxDiscount);
  const [color, setColor] = useState(brandColor);
  const [mem, setMem] = useState(memberships === "1");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function save() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          qr_max_pending_orders: String(Math.max(1, Math.min(50, Math.floor(Number(qr) || 5)))),
          staff_max_discount_percent: String(Math.max(0, Math.min(100, Math.floor(Number(disc) === 0 ? 0 : Number(disc) || 100)))),
          package_max_hours_per_session: String(Math.max(0, Math.min(24, Math.floor(Number(pkgCap) || 0)))),
          brand_color: color,
          feature_memberships: mem ? "1" : "0",
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setMsg({ type: "err", text: f.t(data?.error || (f.en ? "Could not save." : "معرفناش نحفظ.")) });
        return;
      }
      setMsg({ type: "ok", text: f.en ? "Saved ✓" : "اتحفظ ✓" });
      router.refresh();
    } catch {
      setMsg({ type: "err", text: f.en ? "No connection to the server. Try again." : "مفيش اتصال بالسيرفر. جرّب تاني." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-bold text-lg">{f.en ? "Business rules and look" : "قواعد الشغل والشكل"}</h3>
        <p className="text-sm text-slate-500 mt-1">
          {f.en
            ? "Limits and accent color used across the app. Changes apply right away."
            : "حدود ولون التطبيق. التغييرات بتتطبق على طول."}
        </p>
      </div>

      <div>
        <label className="label" htmlFor="qr-cap">
          {f.en ? "Max pending QR orders per customer session" : "أقصى عدد طلبات QR معلقة للجلسة الواحدة"}
        </label>
        <input id="qr-cap" className="input" type="number" min={1} max={50} value={qr} disabled={loading} onChange={(e) => { setQr(e.target.value); setMsg(null); }} />
      </div>

      <div>
        <label className="label" htmlFor="pkg-cap">
          {f.en ? "Max package hours one session can use" : "أقصى ساعات باقة تتخصم من الجلسة الواحدة"}
        </label>
        <input id="pkg-cap" className="input" type="number" min={0} max={24} value={pkgCap} disabled={loading} onChange={(e) => { setPkgCap(e.target.value); setMsg(null); }} />
        <p className="text-xs text-slate-400 mt-1">
          {f.en ? "0 = no limit (every started hour is deducted)." : "0 = من غير حد (كل ساعة بتبدأ بتتخصم)."}
        </p>
      </div>

      <div>
        <label className="label" htmlFor="staff-disc">
          {f.en ? "Biggest session discount staff can give (% of subtotal)" : "أكبر خصم يقدر الموظف يديه على الجلسة (% من الإجمالي)"}
        </label>
        <input id="staff-disc" className="input" type="number" min={0} max={100} value={disc} disabled={loading} onChange={(e) => { setDisc(e.target.value); setMsg(null); }} />
        <p className="text-xs text-slate-400 mt-1">
          {f.en ? "100 = no limit. Managers and admins are never limited." : "100 = من غير حد. المدير والأدمن ملهمش حد."}
        </p>
      </div>

      <div>
        <label className="label">{f.en ? "Accent color" : "لون التطبيق"}</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {PRESETS.map((p) => (
            <button
              key={p.color}
              type="button"
              disabled={loading}
              onClick={() => { setColor(p.color); setMsg(null); }}
              className="btn btn-ghost"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, outline: color === p.color ? `2px solid ${p.color}` : undefined }}
            >
              <span style={{ width: 16, height: 16, borderRadius: 999, background: p.color, display: "inline-block" }} />
              {f.en ? p.name : p.ar}
            </button>
          ))}
          <input type="color" aria-label={f.en ? "Custom color" : "لون مخصص"} value={color} disabled={loading} onChange={(e) => { setColor(e.target.value); setMsg(null); }} style={{ width: 40, height: 36, border: 0, background: "none", cursor: "pointer" }} />
        </div>
      </div>

      <div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={mem} disabled={loading} onChange={(e) => { setMem(e.target.checked); setMsg(null); }} />
          {f.en ? "Monthly memberships (optional feature)" : "الاشتراكات الشهرية (ميزة اختيارية)"}
        </label>
        <p className="text-xs text-slate-400 mt-1">
          {f.en ? "Run optional-migrations/001_memberships.sql first (see the README there)." : "شغّل ملف optional-migrations/001_memberships.sql الأول (التفاصيل في README)."}
        </p>
      </div>

      {msg && (
        <div className={`v2-alert ${msg.type === "ok" ? "green" : "red"}`}>{msg.text}</div>
      )}

      <button type="button" className="btn btn-primary" disabled={loading} onClick={save}>
        {loading ? (f.en ? "Saving…" : "بيحفظ…") : f.en ? "Save" : "حفظ"}
      </button>
    </div>
  );
}
