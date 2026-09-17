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

  if (!Number.isSafeInteger(Math.round(amount * 100))) {
    return null;
  }

  return Math.round(amount * 100) / 100;
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

export default function OpenShiftForm({
  currency,
}: {
  currency: string;
}) {
  const router = useRouter();

  const [openingCash, setOpeningCash] = useState("0");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setError(null);

    const normalizedOpeningCash = openingCash.trim();
    const parsedOpeningCash = parseMoney(normalizedOpeningCash);

    if (parsedOpeningCash === null) {
      setError(
        "Please enter a valid opening cash amount greater than or equal to 0.",
      );
      return;
    }

    const normalizedNote = note.trim();

    if (normalizedNote.length > MAX_NOTE_LENGTH) {
      setError(
        `Note cannot exceed ${MAX_NOTE_LENGTH} characters.`,
      );
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          openingCash: parsedOpeningCash,
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
          serverError || "Failed to open shift. Please try again.",
        );
        setLoading(false);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError(
        "A network error occurred. Please check your connection and try again.",
      );
      setLoading(false);
    }
  }

  function handleOpeningCashChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const value = e.target.value;

    if (value === "") {
      setOpeningCash("");
      return;
    }

    if (!/^\d*\.?\d{0,2}$/.test(value)) {
      return;
    }

    setOpeningCash(value);
  }

  function handleNoteChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    setNote(e.target.value.slice(0, MAX_NOTE_LENGTH));
  }

  const canSubmit = !loading && parseMoney(openingCash) !== null;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label
          htmlFor="opening-cash"
          className="label"
        >
          Opening cash in drawer ({currency})
        </label>

        <input
          id="opening-cash"
          className="input text-2xl font-bold text-center"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={openingCash}
          onChange={handleOpeningCashChange}
          required
          autoFocus
          aria-describedby="opening-cash-help"
          disabled={loading}
        />

        <p
          id="opening-cash-help"
          className="text-xs text-slate-500 mt-1"
        >
          Enter the actual amount of cash you found in the register at
          the start of your shift.
        </p>
      </div>

      <div>
        <label
          htmlFor="shift-note"
          className="label"
        >
          Note (optional)
        </label>

        <input
          id="shift-note"
          className="input"
          value={note}
          onChange={handleNoteChange}
          placeholder="Anything worth noting for this shift…"
          maxLength={MAX_NOTE_LENGTH}
          autoComplete="off"
          disabled={loading}
        />

        <div className="text-xs text-slate-400 mt-1 text-right">
          {note.length}/{MAX_NOTE_LENGTH}
        </div>
      </div>

      {error && (
        <div
          className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"
          role="alert"
          aria-live="polite"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary w-full py-3"
        disabled={!canSubmit}
      >
        {loading
          ? "Opening shift…"
          : "Open shift & start working →"}
      </button>
    </form>
  );
}