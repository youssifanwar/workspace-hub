"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AccountSettings({
  username,
  fullName,
}: {
  username: string;
  fullName: string;
}) {
  const router = useRouter();
  const [uname, setUname] = useState(username);
  const [name, setName] = useState(fullName);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: uname,
        fullName: name,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setMsg({ type: "err", text: data.error || "Failed" });
      return;
    }
    setMsg({ type: "ok", text: "Account updated ✓" });
    setCurrentPassword("");
    setNewPassword("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Username</label>
          <input
            className="input"
            value={uname}
            onChange={(e) => setUname(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Full name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="pt-3 border-t border-slate-100">
        <div className="text-xs font-semibold text-slate-500 mb-2">
          🔐 Change password (optional)
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Current password</label>
            <input
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="label">New password</label>
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>
      </div>

      {msg && (
        <div
          className={`p-3 rounded-xl text-sm ${
            msg.type === "ok"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={loading}>
        {loading ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
