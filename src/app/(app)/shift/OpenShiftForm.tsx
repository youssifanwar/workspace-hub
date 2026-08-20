"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OpenShiftForm({ currency }: { currency: string }) {
  const router = useRouter();
  const [openingCash, setOpeningCash] = useState("0");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingCash: parseFloat(openingCash) || 0, note }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed");
      setLoading(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">
          Opening cash in drawer ({currency})
        </label>
        <input
          className="input text-2xl font-bold text-center"
          type="number"
          step="0.01"
          min="0"
          value={openingCash}
          onChange={(e) => setOpeningCash(e.target.value)}
          required
          autoFocus
        />
        <p className="text-xs text-slate-500 mt-1">
          Enter the actual amount of cash you found in the register at the
          start of your shift.
        </p>
      </div>
      <div>
        <label className="label">Note (optional)</label>
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything worth noting for this shift…"
        />
      </div>
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}
      <button type="submit" className="btn btn-primary w-full py-3" disabled={loading}>
        {loading ? "Opening shift…" : "Open shift & start working →"}
      </button>
    </form>
  );
}
