"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = { username: string; fullName: string };

export default function HandoverForm({
  candidates,
  expectedCash,
  currency,
  holderName,
}: {
  candidates: Candidate[];
  expectedCash: number | null;
  currency: string;
  /** Set when an admin is handing over someone else's shift. */
  holderName?: string;
}) {
  const router = useRouter();
  const [toUsername, setToUsername] = useState("");
  const [closingCash, setClosingCash] = useState(
    expectedCash !== null ? expectedCash.toFixed(2) : "",
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit() {
    if (saving) return;
    setError(null);
    setSuccess(null);
    if (!toUsername) {
      setError("Choose who is taking over.");
      return;
    }
    if (
      !confirm(
        `Hand the shift over${holderName ? ` from ${holderName}` : ""} to ${
          candidates.find((c) => c.username === toUsername)?.fullName ?? toUsername
        }? Customers currently in the space will stay open and move to the new shift.`,
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/shifts/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toUsername,
          closingCash: closingCash.trim() === "" ? undefined : Number(closingCash),
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Could not hand over the shift.");
        return;
      }
      setSuccess(
        `Shift handed to ${data.toUserFullName}. ${data.movedSessions} active session(s) moved with it.`,
      );
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Use this when the next employee arrives and customers are still
        inside. Open sessions continue without interruption; you close your
        cash count and they start theirs.
      </p>

      <div>
        <label className="label">Hand over to</label>
        <select
          className="select"
          value={toUsername}
          disabled={saving}
          onChange={(e) => setToUsername(e.target.value)}
        >
          <option value="">Select employee…</option>
          {candidates.map((c) => (
            <option key={c.username} value={c.username}>
              {c.fullName} ({c.username})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">
          Counted cash in drawer ({currency})
        </label>
        <input
          className="input"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={closingCash}
          disabled={saving}
          onChange={(e) => setClosingCash(e.target.value)}
        />
        <p className="text-xs text-slate-500 mt-1">
          The new employee starts with this same amount. Leave empty to use
          the expected amount.
        </p>
      </div>

      <div>
        <label className="label">Note (optional)</label>
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
        {saving ? "Handing over…" : "🤝 Hand over shift"}
      </button>
    </div>
  );
}
