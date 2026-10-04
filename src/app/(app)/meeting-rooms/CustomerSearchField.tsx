"use client";

import { useEffect, useRef, useState } from "react";

type Match = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
};

export default function CustomerSearchField({
  name,
  phone,
  onPick,
  onNameChange,
  onPhoneChange,
  disabled,
}: {
  name: string;
  phone: string;
  onPick: (customer: Match) => void;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Match[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/customers/search?q=${encodeURIComponent(query.trim())}`,
        );
        const data = await res.json().catch(() => ({}));
        if (id !== requestId.current) return;
        setResults(data.customers ?? []);
      } catch {
        if (id === requestId.current) setResults([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div ref={boxRef} className="relative">
      <label className="block text-sm font-semibold text-slate-700 mb-1">
        Find an existing customer (optional)
      </label>
      <input
        className="input w-full"
        placeholder="Search by name or phone…"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto">
          {loading ? (
            <div className="p-3 text-sm text-slate-400">Searching…</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-sm text-slate-400">
              No match — a new customer will be created with the name/phone
              below.
            </div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm"
                onClick={() => {
                  onPick(c);
                  setQuery(`${c.name} — ${c.phone}`);
                  setOpen(false);
                }}
              >
                <div className="font-semibold">{c.name}</div>
                <div className="text-slate-500 text-xs">{c.phone}</div>
              </button>
            ))
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-2">
        <input
          className="input"
          placeholder="Customer name"
          value={name}
          disabled={disabled}
          onChange={(e) => onNameChange(e.target.value)}
        />
        <input
          className="input"
          placeholder="Phone"
          value={phone}
          disabled={disabled}
          onChange={(e) => onPhoneChange(e.target.value)}
        />
      </div>
    </div>
  );
}
