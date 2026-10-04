"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
}: {
  customerId: number;
  customerName: string;
  customerPhone: string;
  currency: string;
}) {
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
      setError("Could not load packages.");
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

  async function sell() {
    if (!packageId) {
      setError("Choose a package first.");
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
              note: note || null,
            }
          : {
              customerId,
              packageId: Number(packageId),
              purchasedAt: new Date(paidAt).toISOString(),
              note: note || null,
            };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Could not register the package.");
        return;
      }
      setSuccess("Package registered successfully.");
      setPackageId("");
      setNote("");
      await load();
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost text-emerald-700"
        onClick={() => setOpen(true)}
      >
        Packages
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">Packages</h2>
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
              <h3 className="font-semibold mb-2">Current packages</h3>
              {loading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : owned.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No packages yet for this customer.
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
                            ({o.kind === "desk" ? "Desk" : "Meeting room"})
                          </span>
                        </div>
                        <div className="text-slate-500">
                          Paid: {new Date(o.purchasedAt).toLocaleString()}
                          {o.expiresAt
                            ? ` · Expires: ${new Date(
                                o.expiresAt,
                              ).toLocaleDateString()}`
                            : " · No expiry"}
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 pt-4 space-y-3">
              <h3 className="font-semibold">Register a new package</h3>

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
                    {k === "desk" ? "Desk hours" : "Meeting room hours"}
                  </button>
                ))}
              </div>

              <div>
                <label className="text-sm font-medium">Package type</label>
                <select
                  className="input w-full"
                  value={packageId}
                  onChange={(e) => setPackageId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {list.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {Number(p.totalHours)}h —{" "}
                      {Number(p.price)} {currency}
                      {p.validityDays ? ` — ${p.validityDays} days` : ""}
                    </option>
                  ))}
                </select>
                {list.length === 0 && !loading && (
                  <p className="text-xs text-amber-600 mt-1">
                    No active {kind === "desk" ? "desk" : "meeting room"}{" "}
                    packages. Create them in Settings first.
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium">Payment date</label>
                <input
                  type="datetime-local"
                  className="input w-full"
                  value={paidAt}
                  max={toLocalInput(new Date())}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Expiry is counted from this date.
                </p>
              </div>

              <div>
                <label className="text-sm font-medium">Note (optional)</label>
                <input
                  className="input w-full"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg p-2">
                  {error}
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
                {saving ? "Saving…" : "Register package"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
