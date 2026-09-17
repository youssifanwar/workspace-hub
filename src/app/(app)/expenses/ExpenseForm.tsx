"use client";

import {
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

const CATEGORIES = [
  "Utilities",
  "Groceries",
  "Cleaning",
  "Maintenance",
  "Salaries",
  "Marketing",
  "Rent",
  "General",
] as const;

type ExpenseResponse = {
  error?: string;
};

function isValidAmount(value: string) {
  const parsed = Number(value);

  return (
    Number.isFinite(parsed) &&
    parsed > 0
  );
}

export default function ExpenseForm({
  currency,
}: {
  currency: string;
}) {
  const router = useRouter();

  const [amount, setAmount] = useState("");
  const [category, setCategory] =
    useState<string>("General");
  const [note, setNote] = useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  async function submit(
    e: FormEvent<HTMLFormElement>,
  ) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setError(null);

    const trimmedAmount =
      amount.trim();

    const numericAmount =
      Number(trimmedAmount);

    const trimmedNote =
      note.trim();

    if (!isValidAmount(trimmedAmount)) {
      setError(
        "Enter a valid amount greater than 0.",
      );
      return;
    }

    if (
      numericAmount >
      9999999999.99
    ) {
      setError(
        "Amount is too large.",
      );
      return;
    }

    if (
      !CATEGORIES.includes(
        category as (typeof CATEGORIES)[number],
      )
    ) {
      setError(
        "Please select a valid category.",
      );
      return;
    }

    if (trimmedNote.length > 500) {
      setError(
        "Note is too long.",
      );
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(
        "/api/expenses",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Accept:
              "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            amount: numericAmount,
            category,
            note: trimmedNote,
          }),
        },
      );

      const data =
        (await res
          .json()
          .catch(
            () => null,
          )) as
          | ExpenseResponse
          | null;

      if (!res.ok) {
        setError(
          data?.error ||
            "Failed to record the expense.",
        );
        return;
      }

      setAmount("");
      setNote("");

      setError(null);

      router.refresh();
    } catch (err) {
      console.error(
        "Expense submission failed:",
        err,
      );

      setError(
        "Could not connect to the server. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3"
      noValidate
    >
      {/* AMOUNT */}
      <div>
        <label
          htmlFor="expense-amount"
          className="label"
        >
          Amount ({currency})
        </label>

        <input
          id="expense-amount"
          name="amount"
          className="input text-lg font-bold"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          max="9999999999.99"
          value={amount}
          onChange={(e) => {
            setAmount(
              e.target.value,
            );
            setError(null);
          }}
          placeholder="0.00"
          autoComplete="off"
          required
          disabled={loading}
        />
      </div>

      {/* CATEGORY */}
      <div>
        <label
          htmlFor="expense-category"
          className="label"
        >
          Category
        </label>

        <select
          id="expense-category"
          name="category"
          className="select"
          value={category}
          onChange={(e) => {
            setCategory(
              e.target.value,
            );
            setError(null);
          }}
          disabled={loading}
        >
          {CATEGORIES.map(
            (item) => (
              <option
                key={item}
                value={item}
              >
                {item}
              </option>
            ),
          )}
        </select>
      </div>

      {/* NOTE */}
      <div>
        <label
          htmlFor="expense-note"
          className="label"
        >
          Note
        </label>

        <input
          id="expense-note"
          name="note"
          className="input"
          value={note}
          onChange={(e) => {
            setNote(
              e.target.value,
            );
            setError(null);
          }}
          placeholder="Describe the expense…"
          maxLength={500}
          autoComplete="off"
          disabled={loading}
        />
      </div>

      {/* ERROR */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* SUBMIT */}
      <button
        type="submit"
        className="btn btn-danger w-full"
        disabled={loading}
        aria-busy={loading}
      >
        {loading
          ? "Saving…"
          : "💸 Record expense"}
      </button>
    </form>
  );
}