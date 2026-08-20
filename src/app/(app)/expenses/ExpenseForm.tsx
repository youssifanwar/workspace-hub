"use client";

import { useState } from "react";
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
];

export default function ExpenseForm({ currency }: { currency: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("General");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: parseFloat(amount) || 0,
        category,
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
        <label className="label">Category</label>
        <select
          className="select"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Note</label>
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Describe the expense…"
        />
      </div>
      {error && (
        <div className="p-3 rounded-xl bg-red-50 text-sm text-red-700">
          {error}
        </div>
      )}
      <button type="submit" className="btn btn-danger w-full" disabled={loading}>
        {loading ? "Saving…" : "💸 Record expense"}
      </button>
    </form>
  );
}
