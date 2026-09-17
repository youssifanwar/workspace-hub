"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MAX_NOTE_LENGTH = 500;

function parseMoney(value: string): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const amount = Number(trimmed);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  const cents = Math.round(amount * 100);

  if (!Number.isSafeInteger(cents)) {
    return null;
  }

  return cents / 100;
}

async function readJsonSafely(
  response: Response,
): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return {};
  }

  try {
    const data: unknown = await response.json();

    if (
      data !== null &&
      typeof data === "object" &&
      !Array.isArray(data)
    ) {
      return data as Record<string, unknown>;
    }

    return {};
  } catch {
    return {};
  }
}

export default function CloseShiftForm({
  expectedCash,
  currency,
}: {
  expectedCash: number;
  currency: string;
}) {
  const router = useRouter();

  const safeExpectedCash =
    Number.isFinite(expectedCash) && expectedCash >= 0
      ? Math.round(expectedCash * 100) / 100
      : 0;

  const [actualCash, setActualCash] = useState(
    safeExpectedCash.toFixed(2),
  );
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const parsedActualCash = parseMoney(actualCash);

  const diff =
    parsedActualCash !== null
      ? Math.round((parsedActualCash - safeExpectedCash) * 100) / 100
      : 0;

  const isBalanced = Math.abs(diff) < 0.01;

  async function submit(
    e: React.FormEvent<HTMLFormElement>,
  ) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setError(null);

    const normalizedActualCash = actualCash.trim();
    const parsedCash = parseMoney(normalizedActualCash);

    if (parsedCash === null) {
      setError(
        "Please enter a valid closing cash amount greater than or equal to 0.",
      );
      setConfirm(false);
      return;
    }

    const normalizedNote = note.trim();

    if (normalizedNote.length > MAX_NOTE_LENGTH) {
      setError(
        `Closing note cannot exceed ${MAX_NOTE_LENGTH} characters.`,
      );
      setConfirm(false);
      return;
    }

    if (!confirm) {
      setConfirm(true);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/shifts/close", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          closingCash: parsedCash,
          note: normalizedNote,
        }),
      });

      const data = await readJsonSafely(res);

      if (!res.ok) {
        const serverError =
          typeof data.error === "string"
            ? data.error.trim()
            : "";

        setError(
          serverError ||
            "Failed to close shift. Please try again.",
        );
        setLoading(false);
        setConfirm(false);
        return;
      }

      const shiftId = data.shiftId;

      if (
        typeof shiftId !== "number" &&
        typeof shiftId !== "string"
      ) {
        setError(
          "Shift closed, but the summary page could not be opened.",
        );
        setLoading(false);
        setConfirm(false);
        router.replace("/shift");
        router.refresh();
        return;
      }

      const normalizedShiftId = String(shiftId).trim();

      if (!normalizedShiftId) {
        setError(
          "Shift closed, but the summary page could not be opened.",
        );
        setLoading(false);
        setConfirm(false);
        router.replace("/shift");
        router.refresh();
        return;
      }

      router.replace(
        `/shift/summary/${encodeURIComponent(normalizedShiftId)}`,
      );
      router.refresh();
    } catch {
      setError(
        "A network error occurred. Please check your connection and try again.",
      );
      setLoading(false);
      setConfirm(false);
    }
  }

  function handleActualCashChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const value = e.target.value;

    if (value === "") {
      setActualCash("");
      setConfirm(false);
      return;
    }

    if (!/^\d*\.?\d{0,2}$/.test(value)) {
      return;
    }

    setActualCash(value);
    setConfirm(false);
    setError(null);
  }

  function handleNoteChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    setNote(e.target.value.slice(0, MAX_NOTE_LENGTH));
  }

  const canSubmit =
    !loading && parsedActualCash !== null;

  return (
    <form
      onSubmit={submit}
      className="space-y-4"
      noValidate
    >
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="actual-cash"
            className="label"
          >
            Actual cash counted in drawer ({currency})
          </label>

          <input
            id="actual-cash"
            className="input text-lg font-bold"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={actualCash}
            onChange={handleActualCashChange}
            required
            disabled={loading}
            aria-describedby="actual-cash-help"
          />

          <p
            id="actual-cash-help"
            className="text-xs text-slate-500 mt-1"
          >
            Count the cash in the drawer and enter the exact amount
            before closing the shift.
          </p>
        </div>

        <div>
          <label
            htmlFor="closing-note"
            className="label"
          >
            Closing note (optional)
          </label>

          <input
            id="closing-note"
            className="input"
            value={note}
            onChange={handleNoteChange}
            placeholder="Cash difference reason, incidents…"
            maxLength={MAX_NOTE_LENGTH}
            autoComplete="off"
            disabled={loading}
          />

          <div className="text-xs text-slate-400 mt-1 text-right">
            {note.length}/{MAX_NOTE_LENGTH}
          </div>
        </div>
      </div>

      <div
        className={`p-4 rounded-xl border text-sm ${
          isBalanced
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : diff > 0
            ? "bg-blue-50 border-blue-200 text-blue-800"
            : "bg-red-50 border-red-200 text-red-800"
        }`}
        aria-live="polite"
      >
        Difference:{" "}
        <span className="font-bold tabular-nums">
          {diff >= 0 ? "+" : ""}
          {diff.toFixed(2)} {currency}
        </span>{" "}
        {isBalanced
          ? "· Balanced ✓"
          : diff > 0
          ? "· Overage"
          : "· Shortage"}
      </div>

      {error && (
        <div
          className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"
          role="alert"
          aria-live="assertive"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        className={`btn ${
          confirm ? "btn-danger" : "btn-primary"
        } w-full py-3`}
        disabled={!canSubmit}
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