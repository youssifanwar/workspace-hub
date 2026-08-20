"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BankForm({ currency }: { currency: string }) {
  const router = useRouter();
  const [type, setType] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/bank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        amount: parseFloat(amount) || 0,
        note: note.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed");
      setLoading(false);
      return;
    }
    setAmount("");
    setNote("");
    setLoading(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setType("deposit")}
          className={`p-3 rounded-xl border font-semibold text-sm ${
            type === "deposit"
              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
              : "border-slate-200"
          }`}
        >
          ⬆️ Deposit
        </button>
        <button
          type="button"
          onClick={() => setType("withdraw")}
          className={`p-3 rounded-xl border font-semibold text-sm ${
            type === "withdraw"
              ? "border-amber-500 bg-amber-50 text-amber-700"
              : "border-slate-200"
          }`}
        >
          ⬇️ Withdraw
        </button>
      </div>
      <div>
        <label className="label">Amount ({currency})</label>
        <input
          className="input text-lg font-bold"
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="label">Note</label>
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reference, receipt #…"
        />
      </div>
      {error && (
        <div className="p-3 rounded-xl bg-red-50 text-sm text-red-700">
          {error}
        </div>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={loading}>
        {loading ? "Saving…" : "Record transaction"}
      </button>
    </form>
  );
}
