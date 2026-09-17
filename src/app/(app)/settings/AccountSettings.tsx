"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type AccountResponse = {
  error?: string;
};

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

  const [msg, setMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setMsg(null);

    const normalizedUsername = uname.trim();
    const normalizedFullName = name.trim();

    if (!normalizedUsername) {
      setMsg({
        type: "err",
        text: "Username is required.",
      });
      return;
    }

    if (!/^[A-Za-z0-9._-]{1,100}$/.test(normalizedUsername)) {
      setMsg({
        type: "err",
        text: "Username may contain only letters, numbers, dots, underscores, and hyphens.",
      });
      return;
    }

    if (!normalizedFullName) {
      setMsg({
        type: "err",
        text: "Full name is required.",
      });
      return;
    }

    if (normalizedFullName.length > 200) {
      setMsg({
        type: "err",
        text: "Full name is too long.",
      });
      return;
    }

    if (newPassword && !currentPassword) {
      setMsg({
        type: "err",
        text: "Enter your current password before choosing a new password.",
      });
      return;
    }

    if (newPassword && newPassword.length < 6) {
      setMsg({
        type: "err",
        text: "New password must be at least 6 characters.",
      });
      return;
    }

    if (newPassword.length > 128) {
      setMsg({
        type: "err",
        text: "New password is too long.",
      });
      return;
    }

    if (currentPassword.length > 128) {
      setMsg({
        type: "err",
        text: "Current password is invalid.",
      });
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          username: normalizedUsername,
          fullName: normalizedFullName,
          currentPassword: currentPassword || undefined,
          newPassword: newPassword || undefined,
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | AccountResponse
        | null;

      if (!res.ok) {
        setMsg({
          type: "err",
          text:
            data?.error ||
            "Failed to update your account.",
        });
        return;
      }

      setMsg({
        type: "ok",
        text: "Account updated ✓",
      });

      setUname(normalizedUsername);
      setName(normalizedFullName);
      setCurrentPassword("");
      setNewPassword("");

      router.refresh();
    } catch (error) {
      console.error("Account update failed:", error);

      setMsg({
        type: "err",
        text:
          "Could not connect to the server. Please try again.",
      });
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
      {/* ACCOUNT DETAILS */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="account-username"
            className="label"
          >
            Username
          </label>

          <input
            id="account-username"
            name="username"
            className="input"
            value={uname}
            onChange={(e) => {
              setUname(e.target.value);
              setMsg(null);
            }}
            maxLength={100}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            disabled={loading}
          />
        </div>

        <div>
          <label
            htmlFor="account-full-name"
            className="label"
          >
            Full name
          </label>

          <input
            id="account-full-name"
            name="fullName"
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setMsg(null);
            }}
            maxLength={200}
            autoComplete="name"
            required
            disabled={loading}
          />
        </div>
      </div>

      {/* PASSWORD */}
      <div className="pt-3 border-t border-slate-100">
        <div className="text-xs font-semibold text-slate-500 mb-2">
          🔐 Change password (optional)
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="current-password"
              className="label"
            >
              Current password
            </label>

            <input
              id="current-password"
              name="currentPassword"
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setMsg(null);
              }}
              autoComplete="current-password"
              maxLength={128}
              disabled={loading}
            />
          </div>

          <div>
            <label
              htmlFor="new-password"
              className="label"
            >
              New password
            </label>

            <input
              id="new-password"
              name="newPassword"
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setMsg(null);
              }}
              autoComplete="new-password"
              minLength={6}
              maxLength={128}
              disabled={loading}
            />
          </div>
        </div>
      </div>

      {/* MESSAGE */}
      {msg && (
        <div
          role="alert"
          aria-live="polite"
          className={`p-3 rounded-xl text-sm ${
            msg.type === "ok"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-100"
              : "bg-red-50 text-red-700 border border-red-100"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* SUBMIT */}
      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}