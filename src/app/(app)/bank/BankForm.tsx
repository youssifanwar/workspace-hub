"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useFmt } from "@/lib/lang-context";

type TransactionType = "deposit" | "withdraw";

type BankResponse = {
  error?: string;
};

function isValidAmount(value: string) {
  const amount = Number(value);

  return Number.isFinite(amount) && amount > 0;
}

export default function BankForm({
  currency,
}: {
  currency: string;
}) {
  const f = useFmt();
  const tx = f.t;
  const router = useRouter();

  const [type, setType] = useState<TransactionType>("deposit");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setError(null);

    const trimmedAmount = amount.trim();
    const numericAmount = Number(trimmedAmount);
    const trimmedNote = note.trim();

    if (!isValidAmount(trimmedAmount)) {
      setError(tx("Enter a valid amount greater than 0."));
      return;
    }

    if (numericAmount > 9999999999.99) {
      setError(tx("Amount is too large."));
      return;
    }

    if (trimmedNote.length > 500) {
      setError(tx("Note is too long."));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/bank", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          type,
          amount: numericAmount,
          note: trimmedNote,
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | BankResponse
        | null;

      if (!res.ok) {
        setError(
          data?.error || tx("Failed to record the transaction."),
        );
        return;
      }

      setAmount("");
      setNote("");

      router.refresh();
    } catch (err) {
      console.error("Bank transaction failed:", err);

      setError(
        tx("Could not connect to the server. Please try again."),
      );
    } finally {
      setLoading(false);
    }
  }

  function changeType(nextType: TransactionType) {
    if (loading) {
      return;
    }

    setType(nextType);
    setError(null);
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3"
      noValidate
    >
      {/* TRANSACTION TYPE */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => changeType("deposit")}
          disabled={loading}
          aria-pressed={type === "deposit"}
          className={`p-3 rounded-xl border font-semibold text-sm transition ${
            type === "deposit"
              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-white hover:border-slate-300"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {tx("⬆️ Deposit")}
        </button>

        <button
          type="button"
          onClick={() => changeType("withdraw")}
          disabled={loading}
          aria-pressed={type === "withdraw"}
          className={`p-3 rounded-xl border font-semibold text-sm transition ${
            type === "withdraw"
              ? "border-amber-500 bg-amber-50 text-amber-700"
              : "border-slate-200 bg-white hover:border-slate-300"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {tx("⬇️ Withdraw")}
        </button>
      </div>

      {/* AMOUNT */}
      <div>
        <label
          htmlFor="bank-amount"
          className="label"
        >
          {f.en ? "Amount" : "المبلغ"} ({currency})
        </label>

        <input
          id="bank-amount"
          name="amount"
          className="input text-lg font-bold"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          max="9999999999.99"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
          placeholder="0.00"
          required
          disabled={loading}
          autoComplete="off"
        />
      </div>

      {/* NOTE */}
      <div>
        <label
          htmlFor="bank-note"
          className="label"
        >
          {tx("Note")}
        </label>

        <input
          id="bank-note"
          name="note"
          className="input"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
          placeholder={tx("Reference, receipt #…")}
          maxLength={500}
          disabled={loading}
          autoComplete="off"
        />
      </div>

      {/* ERROR */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700"
        >
          {tx(error)}
        </div>
      )}

      {/* SUBMIT */}
      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={loading}
        aria-busy={loading}
      >
        {loading
          ? tx("Saving…")
          : type === "deposit"
            ? tx("Record deposit")
            : tx("Record withdrawal")}
      </button>
    </form>
  );
}