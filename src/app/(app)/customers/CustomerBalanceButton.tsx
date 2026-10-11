"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Tx = {
  id: number;
  type: string;
  amount: number;
  balanceAfter: number;
  paymentMethod: string | null;
  note: string | null;
  createdAt: string;
};

const TYPE_LABEL: Record<string, string> = {
  deposit: "Top-up",
  payment: "Payment",
  refund: "Refund",
  adjustment: "Adjustment",
};

export default function CustomerBalanceButton({
  customerId,
  customerName,
  balance,
  currency,
  canAdjust,
}: {
  customerId: number;
  customerName: string;
  balance: number;
  currency: string;
  canAdjust: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(balance);
  const [history, setHistory] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(false);

  const [mode, setMode] = useState<"deposit" | "adjustment">("deposit");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "visa" | "instapay">("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/balance`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCurrent(Number(data.balance));
        setHistory(data.transactions ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (open) {
      setError(null);
      setSuccess(null);
      void load();
    }
  }, [open, load]);

  async function submit() {
    if (saving) return;
    setError(null);
    setSuccess(null);
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (mode === "deposit" && value < 0) {
      setError("Top-up must be a positive amount.");
      return;
    }
    if (mode === "adjustment" && !note.trim()) {
      setError("Write a note explaining the adjustment.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: mode,
          amount: value,
          paymentMethod: mode === "deposit" ? method : undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Could not update the balance.");
        return;
      }
      setSuccess(
        mode === "deposit"
          ? `Added ${value.toFixed(2)} ${currency}.`
          : "Balance adjusted.",
      );
      setAmount("");
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
        className="btn btn-ghost text-indigo-700"
        onClick={() => setOpen(true)}
      >
        👛 Balance
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">Account balance</h2>
                <p className="text-sm text-slate-500">{customerName}</p>
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

            <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white p-5">
              <div className="text-xs uppercase tracking-wide text-white/80">
                Available balance
              </div>
              <div className="text-3xl font-bold tabular-nums mt-1">
                {current.toFixed(2)} {currency}
              </div>
              <div className="text-xs text-white/80 mt-1">
                Can be used to pay for sessions and packages.
              </div>
            </div>

            <div className="space-y-3">
              {canAdjust && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`btn flex-1 ${mode === "deposit" ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setMode("deposit")}
                  >
                    Add money
                  </button>
                  <button
                    type="button"
                    className={`btn flex-1 ${mode === "adjustment" ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setMode("adjustment")}
                  >
                    Manual adjustment
                  </button>
                </div>
              )}

              <div>
                <label className="label">
                  {mode === "deposit"
                    ? `Amount received (${currency})`
                    : `Adjustment (${currency}, negative to deduct)`}
                </label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  disabled={saving}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              {mode === "deposit" && (
                <div>
                  <label className="label">Paid by</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["cash", "visa", "instapay"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMethod(m)}
                        className={`p-3 rounded-xl border font-semibold text-sm capitalize ${
                          method === m
                            ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        {m === "cash" ? "💵" : m === "visa" ? "💳" : "📱"}{" "}
                        {m === "instapay" ? "InstaPay" : m}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="label">
                  Note {mode === "adjustment" ? "(required)" : "(optional)"}
                </label>
                <input
                  className="input"
                  maxLength={500}
                  value={note}
                  disabled={saving}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {error && (
                <div role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-2">
                  {error}
                </div>
              )}
              {success && (
                <div role="status" className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-2">
                  {success}
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary w-full"
                disabled={saving}
                onClick={submit}
              >
                {saving
                  ? "Saving…"
                  : mode === "deposit"
                    ? "Add to balance"
                    : "Apply adjustment"}
              </button>
            </div>

            <div>
              <h3 className="font-semibold mb-2">History</h3>
              {loading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-slate-400">No transactions yet.</p>
              ) : (
                <div className="divide-soft">
                  {history.map((t) => (
                    <div key={t.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium">
                          {TYPE_LABEL[t.type] ?? t.type}
                          {t.paymentMethod ? ` · ${t.paymentMethod}` : ""}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {new Date(t.createdAt).toLocaleString()}
                          {t.note ? ` · ${t.note}` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={`font-bold tabular-nums ${
                            t.amount >= 0 ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {t.amount >= 0 ? "+" : ""}
                          {t.amount.toFixed(2)}
                        </div>
                        <div className="text-xs text-slate-400 tabular-nums">
                          = {t.balanceAfter.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
