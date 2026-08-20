"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function QrUrlSettings({
  configured,
  detected,
}: {
  configured: string;
  detected: string;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(configured);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public_base_url: url.trim() }),
    });
    setLoading(false);
    if (!res.ok) {
      setMsg({ type: "err", text: "Failed to save" });
      return;
    }
    setMsg({ type: "ok", text: "Saved. New QR codes will use this URL." });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="p-3 rounded-xl bg-slate-50 text-xs">
        <div className="text-slate-500 uppercase font-semibold">
          Auto-detected LAN IP
        </div>
        <div className="font-mono text-slate-800 mt-1">http://{detected}:3000</div>
      </div>

      <div>
        <label className="label">Custom public URL (optional)</label>
        <input
          className="input font-mono"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="e.g. http://192.168.1.20:3000"
        />
        <p className="text-xs text-slate-500 mt-2">
          Leave empty to use the auto-detected LAN address. Set a custom URL if
          you use a fixed hostname (e.g. <code>menu.mycafe.local</code>) or if
          your customers are on a different subnet.
        </p>
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

      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? "Saving…" : "Save URL"}
      </button>
    </form>
  );
}
