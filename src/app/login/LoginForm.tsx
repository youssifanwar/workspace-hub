"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type LoginResponse = {
  error?: string;
};

export default function LoginForm() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (loading) return;

    const normalizedUsername = username.trim();

    if (!normalizedUsername) {
      setError("Please enter your username.");
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    if (normalizedUsername.length > 100) {
      setError("Invalid username.");
      return;
    }

    if (password.length > 128) {
      setError("Invalid password.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: normalizedUsername,
          password,
        }),
        cache: "no-store",
      });

      let data: LoginResponse = {};

      try {
        data = (await res.json()) as LoginResponse;
      } catch {
        data = {};
      }

      if (!res.ok) {
        setError(data.error || "Invalid username or password.");
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4"
      noValidate
    >
      <div>
        <label htmlFor="login-username" className="label">
          Username
        </label>

        <input
          id="login-username"
          name="username"
          className="input"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            if (error) setError(null);
          }}
          placeholder="admin"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          autoFocus
          disabled={loading}
          maxLength={100}
        />
      </div>

      <div>
        <label htmlFor="login-password" className="label">
          Password
        </label>

        <input
          id="login-password"
          name="password"
          className="input"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          placeholder="••••••••"
          autoComplete="current-password"
          required
          disabled={loading}
          maxLength={128}
        />
      </div>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary w-full py-3"
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? "Signing in…" : "Sign in →"}
      </button>
    </form>
  );
}