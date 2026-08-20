"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type D = {
  id: number;
  name: string;
  type: "desk" | "meeting_room";
  hourlyRate: string;
};

export default function DesksAdmin({
  desks,
  currency,
}: {
  desks: D[];
  currency: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Record<number, { name: string; rate: string }>>({});

  function startEdit(d: D) {
    setEditing((p) => ({
      ...p,
      [d.id]: { name: d.name, rate: parseFloat(d.hourlyRate).toString() },
    }));
  }

  async function save(d: D) {
    const e = editing[d.id];
    if (!e) return;
    await fetch(`/api/desks/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: e.name,
        hourlyRate: parseFloat(e.rate) || 0,
      }),
    });
    setEditing((p) => {
      const c = { ...p };
      delete c[d.id];
      return c;
    });
    router.refresh();
  }

  async function del(d: D) {
    if (!confirm(`Deactivate "${d.name}"?`)) return;
    await fetch(`/api/desks/${d.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <button onClick={() => setAdding(true)} className="btn btn-primary">
          + Add desk/room
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase text-left">
            <tr>
              <th className="py-2">Name</th>
              <th>Type</th>
              <th>Hourly rate</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {desks.map((d) => {
              const ed = editing[d.id];
              return (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="py-2">
                    {ed ? (
                      <input
                        className="input !py-1"
                        value={ed.name}
                        onChange={(e) =>
                          setEditing((p) => ({
                            ...p,
                            [d.id]: { ...ed, name: e.target.value },
                          }))
                        }
                      />
                    ) : (
                      <span className="font-semibold">{d.name}</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${d.type === "meeting_room" ? "badge-amber" : "badge-blue"}`}>
                      {d.type === "meeting_room" ? "Room" : "Desk"}
                    </span>
                  </td>
                  <td>
                    {ed ? (
                      <input
                        type="number"
                        className="input !py-1 w-24"
                        step="0.01"
                        value={ed.rate}
                        onChange={(e) =>
                          setEditing((p) => ({
                            ...p,
                            [d.id]: { ...ed, rate: e.target.value },
                          }))
                        }
                      />
                    ) : (
                      <span>
                        {parseFloat(d.hourlyRate).toFixed(2)} {currency}
                      </span>
                    )}
                  </td>
                  <td className="text-right space-x-1">
                    {ed ? (
                      <>
                        <button className="btn btn-success !py-1 !px-2 text-xs" onClick={() => save(d)}>Save</button>
                        <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => setEditing((p) => { const c = { ...p }; delete c[d.id]; return c; })}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => startEdit(d)}>✏️</button>
                        <button className="btn btn-danger !py-1 !px-2 text-xs" onClick={() => del(d)}>🗑</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adding && <AddDeskModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); router.refresh(); }} currency={currency} />}
    </>
  );
}

function AddDeskModal({ onClose, onSaved, currency }: { onClose: () => void; onSaved: () => void; currency: string }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"desk" | "meeting_room">("desk");
  const [rate, setRate] = useState("25");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/desks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, hourlyRate: parseFloat(rate) || 0 }),
    });
    setLoading(false);
    if (res.ok) onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h3 className="text-xl font-bold mb-4">Add desk / meeting room</h3>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setType("desk")} className={`p-3 rounded-xl border font-semibold text-sm ${type === "desk" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200"}`}>🪑 Desk</button>
              <button type="button" onClick={() => setType("meeting_room")} className={`p-3 rounded-xl border font-semibold text-sm ${type === "meeting_room" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200"}`}>👥 Room</button>
            </div>
          </div>
          <div>
            <label className="label">Hourly rate ({currency})</label>
            <input className="input" type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} required />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
              {loading ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
