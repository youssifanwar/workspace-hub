"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type U = {
  id: number;
  username: string;
  fullName: string;
  role: "admin" | "manager" | "employee";
  active: boolean;
};

export default function UsersAdmin({ users }: { users: U[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function toggleActive(u: U) {
    await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    router.refresh();
  }

  async function changeRole(u: U, role: U["role"]) {
    await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    router.refresh();
  }

  async function resetPassword(u: U) {
    const pw = prompt(`Enter a new password for ${u.username}:`);
    if (!pw) return;
    const res = await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: pw }),
    });
    if (res.ok) alert("Password updated ✓");
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <button onClick={() => setCreating(true)} className="btn btn-primary">
          + New user
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase text-left">
            <tr>
              <th className="py-2">User</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-bold">
                      {u.fullName.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-semibold">{u.fullName}</span>
                  </div>
                </td>
                <td>@{u.username}</td>
                <td>
                  <select
                    className="select !py-1 !text-sm w-32"
                    value={u.role}
                    onChange={(e) => changeRole(u, e.target.value as U["role"])}
                  >
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                    <option value="employee">Employee</option>
                  </select>
                </td>
                <td>
                  <span className={`badge ${u.active ? "badge-green" : "badge-red"}`}>
                    {u.active ? "Active" : "Disabled"}
                  </span>
                </td>
                <td className="text-right space-x-1">
                  <button
                    onClick={() => resetPassword(u)}
                    className="btn btn-ghost !py-1 !px-2 text-xs"
                  >
                    🔑
                  </button>
                  <button
                    onClick={() => toggleActive(u)}
                    className="btn btn-ghost !py-1 !px-2 text-xs"
                  >
                    {u.active ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <NewUserModal onClose={() => setCreating(false)} onSaved={() => {
          setCreating(false);
          router.refresh();
        }} />
      )}
    </>
  );
}

function NewUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "manager" | "employee">("employee");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, fullName, password, role }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Failed");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-xl font-bold">New user</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 grid place-items-center">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Full name</label>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Username</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </div>
          <div>
            <label className="label">Role</label>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as "admin" | "manager" | "employee")}>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {error && <div className="p-3 rounded-xl bg-red-50 text-sm text-red-700">{error}</div>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
              {loading ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
