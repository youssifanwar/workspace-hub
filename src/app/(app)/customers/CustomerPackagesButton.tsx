"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useFmt } from "@/lib/lang-context";

type Kind = "desk" | "meeting";

type Pkg = {
  id: number;
  name: string;
  totalHours: number | string;
  price: number | string;
  validityDays: number | null;
  active?: boolean;
  status?: string;
};

type Owned = {
  id: number;
  kind: Kind;
  name: string;
  totalHours: number;
  remainingHours: number;
  price: number;
  purchasedAt: string;
  expiresAt: string | null;
  status: string;
};

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function CustomerPackagesButton({
  customerId,
  customerName,
  customerPhone,
  currency,
  balance = 0,
  canVoid = false,
}: {
  customerId: number;
  customerName: string;
  customerPhone: string;
  currency: string;
  balance?: number;
  canVoid?: boolean;
}) {
  const f = useFmt();
  const tx = f.t;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [deskPkgs, setDeskPkgs] = useState<Pkg[]>([]);
  const [meetingPkgs, setMeetingPkgs] = useState<Pkg[]>([]);
  const [owned, setOwned] = useState<Owned[]>([]);

  const [kind, setKind] = useState<Kind>("desk");
  const [packageId, setPackageId] = useState("");
  const [paidAt, setPaidAt] = useState(toLocalInput(new Date()));
  const [note, setNote] = useState("");
  const [payMethod, setPayMethod] = useState<
    "cash" | "visa" | "instapay" | "balance"
  >("cash");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dRes, mRes, dsRes, msRes] = await Promise.all([
        fetch("/api/subscription-packages", { cache: "no-store" }),
        fetch("/api/meeting-rooms/packages", { cache: "no-store" }),
        fetch(`/api/customers/${customerId}/subscription`, {
          cache: "no-store",
        }),
        fetch(
          `/api/meeting-rooms/packages/customer?phone=${encodeURIComponent(
            customerPhone,
          )}`,
          { cache: "no-store" },
        ),
      ]);

      const d = await dRes.json().catch(() => ({}));
      const m = await mRes.json().catch(() => ({}));
      const ds = await dsRes.json().catch(() => ({}));
      const ms = await msRes.json().catch(() => ({}));

      setDeskPkgs(
        (d.packages ?? []).filter((p: Pkg) => p.active !== false),
      );
      setMeetingPkgs(
        (m.packages ?? []).filter((p: Pkg) => p.status === "active"),
      );

      const list: Owned[] = [];
      if (ds?.subscription) {
        const s = ds.subscription;
        list.push({
          id: s.id,
          kind: "desk",
          name: s.packageName,
          totalHours: Number(s.totalHours),
          remainingHours: Number(s.remainingHours),
          price: Number(s.price),
          purchasedAt: s.purchasedAt,
          expiresAt: s.expiresAt,
          status: s.status,
        });
      }
      for (const p of ms?.packages ?? []) {
        list.push({
          id: p.id,
          kind: "meeting",
          name: p.packageName ?? p.packageNameSnapshot,
          totalHours: Number(p.totalHours ?? p.totalHoursSnapshot),
          remainingHours: Number(p.remainingHours),
          price: Number(p.price ?? p.priceSnapshot),
          purchasedAt: p.purchasedAt,
          expiresAt: p.expiresAt,
          status: p.status,
        });
      }
      setOwned(list);
    } catch {
      setError(tx("Could not load packages."));
    } finally {
      setLoading(false);
    }
  }, [customerId, customerPhone]);

  useEffect(() => {
    if (open) {
      setPaidAt(toLocalInput(new Date()));
      setSuccess(null);
      void load();
    }
  }, [open, load]);

  const list = kind === "desk" ? deskPkgs : meetingPkgs;

  async function voidPackage(item: Owned) {
    const reason = window.prompt(
      (f.en ? `Void "${item.name}"? Only unused packages can be voided.\nWrite the reason:` : `إلغاء "${item.name}"؟ الباقات اللي لسه ما اتستخدمتش بس هي اللي تتلغي.\nاكتب السبب:`),
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setError(tx("A reason is required to void a package."));
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/packages/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: item.kind,
          purchaseId: item.id,
          reason: reason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || tx("Could not void the package."));
        return;
      }
      setSuccess(
        data.refund === "balance"
          ? tx("Package voided and refunded to the customer's balance.")
          : data.paymentMethod === "cash"
            ? tx("Package voided. Hand the cash back to the customer.")
            : tx("Package voided. Refund the customer through the same payment method."),
      );
      await load();
      router.refresh();
    } catch {
      setError(tx("Network error. Try again."));
    }
  }

  async function sell() {
    if (!packageId) {
      setError(tx("Choose a package first."));
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const url =
        kind === "desk"
          ? `/api/customers/${customerId}/subscription`
          : "/api/meeting-rooms/packages/customer";
      const payload =
        kind === "desk"
          ? {
              packageId: Number(packageId),
              purchasedAt: new Date(paidAt).toISOString(),
              paymentMethod: payMethod,
              note: note || null,
            }
          : {
              customerId,
              packageId: Number(packageId),
              purchasedAt: new Date(paidAt).toISOString(),
              paymentMethod: payMethod,
              note: note || null,
            };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || tx("Could not register the package."));
        return;
      }
      setSuccess(tx("Package registered successfully."));
      setPackageId("");
      setNote("");
      await load();
      router.refresh();
    } catch {
      setError(tx("Network error. Try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost text-teal-700"
        onClick={() => setOpen(true)}
      >
        {tx("الباقات والساعات")}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
            <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold">{tx("Customer packages & hours")}</h2>
                  <p className="text-sm text-slate-500">
                    {customerName} · {customerPhone}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setOpen(false);
                    router.refresh();
                  }}
                >
                  ✕
                </button>
              </div>

              <div>
                <h3 className="font-semibold mb-2">{tx("Current packages")}</h3>
                {loading ? (
                  <p className="text-sm text-slate-400">{tx("Loading…")}</p>
                ) : owned.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    {tx("No packages yet for this customer.")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {owned.map((o) => (
                      <div
                        key={`${o.kind}-${o.id}`}
                        className="border border-slate-200 rounded-lg p-3 text-sm flex flex-wrap justify-between gap-2"
                      >
                        <div>
                          <div className="font-semibold">
                            {o.name}{" "}
                            <span className="text-xs text-slate-500">
                              ({o.kind === "desk" ? tx("Desk") : tx("Meeting room")})
                            </span>
                          </div>
                          <div className="text-slate-500">
                            {tx("Paid")}: {new Date(o.purchasedAt).toLocaleString()}
                            {o.expiresAt
                              ? ` · ${tx("Expires")}: ${new Date(
                                  o.expiresAt,
                                ).toLocaleDateString()}`
                              : ` · ${tx("No expiry")}`}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold tabular-nums">
                            {o.remainingHours.toFixed(2)} /{" "}
                            {o.totalHours.toFixed(2)} h
                          </div>
                          <div className="text-slate-500">
                            {o.price.toFixed(2)} {currency} · {o.status}
                          </div>
                          {canVoid && o.status === "active" && (
                            <button
                              type="button"
                              className="text-xs text-red-600 font-semibold mt-1 hover:underline"
                              onClick={() => void voidPackage(o)}
                            >
                              {tx("Void (sold by mistake)")}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-3">
                <h3 className="font-semibold">
                  {tx("Assign / sell a package to this customer")}
                </h3>
                <p className="text-sm text-slate-500">
                  {tx("Create package definitions first in Settings → Meeting Room Packages. Then choose Desk hours or Meeting room hours below and register the sale using the customer's payment method.")}
                </p>

                <div className="flex gap-2">
                  {(["desk", "meeting"] as Kind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setKind(k);
                        setPackageId("");
                      }}
                      className={`btn ${
                        kind === k ? "btn-primary" : "btn-ghost"
                      }`}
                    >
                      {k === "desk" ? tx("Desk hours") : tx("Meeting room hours")}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="text-sm font-medium">{tx("Package type")}</label>
                  <select
                    className="input w-full"
                    value={packageId}
                    onChange={(e) => setPackageId(e.target.value)}
                  >
                    <option value="">{tx("Select…")}</option>
                    {list.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {Number(p.totalHours)}h —{" "}
                        {Number(p.price)} {currency}
                        {p.validityDays ? ` — ${p.validityDays} ${tx("days")}` : ""}
                      </option>
                    ))}
                  </select>
                  {list.length === 0 && !loading && (
                    <p className="text-xs text-amber-600 mt-1">
                      {f.en ? `No active ${kind === "desk" ? "desk" : "meeting room"} packages. Create them in Settings first.` : `مفيش باقات ${kind === "desk" ? "مكاتب" : "غرف اجتماعات"} نشطة. اعملها من الإعدادات الأول.`}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium">{tx("Paid by")}</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                    {(["cash", "visa", "instapay", "balance"] as const).map(
                      (m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPayMethod(m)}
                          className={`p-2.5 rounded-xl border font-semibold text-sm capitalize ${
                            payMethod === m
                              ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                              : "border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          {m === "instapay"
                            ? tx("InstaPay")
                            : m === "balance"
                              ? `${tx("Balance")} · ${balance.toFixed(2)}`
                              : m}
                        </button>
                      ),
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">{tx("Payment date")}</label>
                  <input
                    type="datetime-local"
                    className="input w-full"
                    value={paidAt}
                    max={toLocalInput(new Date())}
                    onChange={(e) => setPaidAt(e.target.value)}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    {tx("Expiry is counted from this date.")}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium">{tx("Note (optional)")}</label>
                  <input
                    className="input w-full"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>

                {error && (
                  <div className="text-sm text-red-600 bg-red-50 rounded-lg p-2">
                    {tx(error)}
                  </div>
                )}
                {success && (
                  <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-2">
                    {success}
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-primary w-full"
                  disabled={saving || !packageId}
                  onClick={sell}
                >
                  {saving ? tx("Saving…") : tx("Register package")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}