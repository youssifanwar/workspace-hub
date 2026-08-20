"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CloseShiftForm({
  expectedCash,
  currency,
}: {
  expectedCash: number;
  currency: string;
}) {
  const router = useRouter();
  const [actualCash, setActualCash] = useState(expectedCash.toFixed(2));
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const diff = parseFloat(actualCash || "0") - expectedCash;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch("/api/shifts/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        closingCash: parseFloat(actualCash) || 0,
        note,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed");
      setLoading(false);
      return;
    }
    router.push(`/shift/summary/${data.shiftId}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="label">Actual cash counted in drawer ({currency})</label>
          <input
            className="input text-lg font-bold"
            type="number"
            step="0.01"
            min="0"
            value={actualCash}
            onChange={(e) => {
              setActualCash(e.target.value);
              setConfirm(false);
            }}
            required
          />
        </div>
        <div>
          <label className="label">Closing note (optional)</label>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Cash difference reason, incidents…"
          />
        </div>
      </div>

      <div
        className={`p-4 rounded-xl border text-sm ${
          Math.abs(diff) < 0.01
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : diff > 0
            ? "bg-blue-50 border-blue-200 text-blue-800"
            : "bg-red-50 border-red-200 text-red-800"
        }`}
      >
        Difference:{" "}
        <span className="font-bold tabular-nums">
          {diff >= 0 ? "+" : ""}
          {diff.toFixed(2)} {currency}
        </span>{" "}
        {Math.abs(diff) < 0.01
          ? "· Balanced ✓"
          : diff > 0
          ? "· Overage"
          : "· Shortage"}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        className={`btn ${confirm ? "btn-danger" : "btn-primary"} w-full py-3`}
        disabled={loading}
      >
        {loading
          ? "Closing…"
          : confirm
          ? "⚠️ Click again to confirm closing this shift"
          : "Close shift →"}
      </button>
    </form>
  );
}
