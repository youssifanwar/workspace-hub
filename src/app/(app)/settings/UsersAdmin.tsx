"use client";

import {
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useFmt } from "@/lib/lang-context";

type U = {
  id: number;
  username: string;
  fullName: string;
  role: "admin" | "manager" | "employee";
  active: boolean;
};

type ApiResponse = {
  error?: string;
};

const ROLES: U["role"][] = [
  "admin",
  "manager",
  "employee",
];

export default function UsersAdmin({
  users,
}: {
  users: U[];
}) {
  const f = useFmt();
  const tx = f.t;
  const router = useRouter();

  const [creating, setCreating] = useState(false);
  const [busyUserId, setBusyUserId] = useState<number | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function patchUser(
    userId: number,
    body: Record<string, unknown>,
  ) {
    if (busyUserId !== null) {
      return false;
    }

    setError(null);
    setBusyUserId(userId);

    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        body: JSON.stringify(body),
      });

      const data = (await res.json().catch(() => null)) as
        | ApiResponse
        | null;

      if (!res.ok) {
        setError(
          data?.error ||
            tx("Failed to update the user."),
        );
        return false;
      }

      router.refresh();
      return true;
    } catch (err) {
      console.error("User update failed:", err);

      setError(
        tx("Could not connect to the server. Please try again."),
      );

      return false;
    } finally {
      setBusyUserId(null);
    }
  }

  async function toggleActive(u: U) {
    if (busyUserId !== null) {
      return;
    }

    await patchUser(u.id, {
      active: !u.active,
    });
  }

  async function changeRole(
    u: U,
    role: U["role"],
  ) {
    if (busyUserId !== null || role === u.role) {
      return;
    }

    await patchUser(u.id, {
      role,
    });
  }

  async function resetPassword(u: U) {
    if (busyUserId !== null) {
      return;
    }

    const pw = window.prompt(
      (f.en ? `Enter a new password for ${u.username}:` : `اكتب كلمة مرور جديدة لـ ${u.username}:`),
    );

    if (pw === null) {
      return;
    }

    if (pw.length < 6) {
      setError(
        tx("Password must be at least 6 characters."),
      );
      return;
    }

    if (pw.length > 128) {
      setError(
        tx("Password must not exceed 128 characters."),
      );
      return;
    }

    const confirmed = window.confirm(
      (f.en ? `Reset the password for ${u.username}?` : `إعادة تعيين كلمة مرور ${u.username}؟`),
    );

    if (!confirmed) {
      return;
    }

    const success = await patchUser(u.id, {
      newPassword: pw,
    });

    if (success) {
      window.alert(tx("Password updated ✓"));
    }
  }

  function openCreateModal() {
    setError(null);
    setCreating(true);
  }

  function closeCreateModal() {
    if (busyUserId !== null) {
      return;
    }

    setCreating(false);
    setError(null);
  }

  return (
    <>
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {tx(error)}
        </div>
      )}

      <div className="flex justify-end mb-3">
        <button
          type="button"
          onClick={openCreateModal}
          className="btn btn-primary"
          disabled={busyUserId !== null}
        >
          {tx("+ New user")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase text-left">
            <tr>
              <th className="py-2">
                {tx("User")}
              </th>

              <th>
                {tx("Username")}
              </th>

              <th>
                {tx("Role")}
              </th>

              <th>
                {tx("Status")}
              </th>

              <th className="text-right">
                {tx("Actions")}
              </th>
            </tr>
          </thead>

          <tbody>
            {users.map((u) => {
              const busy = busyUserId === u.id;

              return (
                <tr
                  key={u.id}
                  className="border-t border-slate-100"
                >
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-bold shrink-0">
                        {u.fullName
                          .charAt(0)
                          .toUpperCase()}
                      </div>

                      <span className="font-semibold">
                        {u.fullName}
                      </span>
                    </div>
                  </td>

                  <td>
                    @{u.username}
                  </td>

                  <td>
                    <select
                      className="select !py-1 !text-sm w-32"
                      value={u.role}
                      onChange={(e) => {
                        const nextRole =
                          e.target.value as U["role"];

                        if (!ROLES.includes(nextRole)) {
                          setError(
                            tx("Invalid role."),
                          );
                          return;
                        }

                        void changeRole(
                          u,
                          nextRole,
                        );
                      }}
                      disabled={
                        busyUserId !== null
                      }
                      aria-label={(f.en ? `Role for ${u.username}` : `دور ${u.username}`)}
                    >
                      <option value="admin">
                        {tx("Admin")}
                      </option>

                      <option value="manager">
                        {tx("Manager")}
                      </option>

                      <option value="employee">
                        {tx("Employee")}
                      </option>
                    </select>
                  </td>

                  <td>
                    <span
                      className={`badge ${
                        u.active
                          ? "badge-green"
                          : "badge-red"
                      }`}
                    >
                      {u.active
                        ? tx("Active")
                        : tx("Disabled")}
                    </span>
                  </td>

                  <td className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          void resetPassword(u)
                        }
                        className="btn btn-ghost !py-1 !px-2 text-xs"
                        disabled={
                          busyUserId !== null
                        }
                        title={tx("Reset password")}
                        aria-label={(f.en ? `Reset password for ${u.username}` : `إعادة تعيين كلمة مرور ${u.username}`)}
                      >
                        🔑
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void toggleActive(u)
                        }
                        className="btn btn-ghost !py-1 !px-2 text-xs"
                        disabled={
                          busyUserId !== null
                        }
                      >
                        {busy
                          ? tx("Saving…")
                          : u.active
                            ? tx("Disable")
                            : tx("Enable")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {users.length === 0 && (
        <div className="text-center py-8 text-sm text-slate-400">
          {tx("No users found.")}
        </div>
      )}

      {creating && (
        <NewUserModal
          onClose={closeCreateModal}
          onSaved={() => {
            setCreating(false);
            setError(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function NewUserModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const f = useFmt();
  const tx = f.t;
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");

  const [role, setRole] =
    useState<U["role"]>("employee");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    null,
  );

  async function submit(
    e: FormEvent<HTMLFormElement>,
  ) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setError(null);

    const normalizedUsername =
      username.trim();

    const normalizedFullName =
      fullName.trim();

    if (!normalizedFullName) {
      setError(
        tx("Full name is required."),
      );
      return;
    }

    if (normalizedFullName.length > 200) {
      setError(
        tx("Full name is too long."),
      );
      return;
    }

    if (
      !/^[A-Za-z0-9._-]{1,100}$/.test(
        normalizedUsername,
      )
    ) {
      setError(
        tx("Username may contain only letters, numbers, dots, underscores, and hyphens."),
      );
      return;
    }

    if (
      password.length < 6 ||
      password.length > 128
    ) {
      setError(
        tx("Password must be between 6 and 128 characters."),
      );
      return;
    }

    if (!ROLES.includes(role)) {
      setError(tx("Invalid role."));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          username: normalizedUsername,
          fullName: normalizedFullName,
          password,
          role,
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | ApiResponse
        | null;

      if (!res.ok) {
        setError(
          data?.error ||
            tx("Failed to create the user."),
        );
        return;
      }

      onSaved();
    } catch (err) {
      console.error(
        "Create user failed:",
        err,
      );

      setError(
        tx("Could not connect to the server. Please try again."),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-user-title"
    >
      <div className="card w-full max-w-md p-6">
        <div className="flex items-start justify-between mb-4">
          <h3
            id="new-user-title"
            className="text-xl font-bold"
          >
            {tx("New user")}
          </h3>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 grid place-items-center"
            aria-label={tx("Close")}
            disabled={loading}
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={submit}
          className="space-y-3"
          noValidate
        >
          {/* FULL NAME */}
          <div>
            <label
              htmlFor="new-user-full-name"
              className="label"
            >
              {tx("Full name")}
            </label>

            <input
              id="new-user-full-name"
              name="fullName"
              className="input"
              value={fullName}
              onChange={(e) => {
                setFullName(
                  e.target.value,
                );
                setError(null);
              }}
              maxLength={200}
              autoComplete="name"
              required
              disabled={loading}
            />
          </div>

          {/* USERNAME + PASSWORD */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="new-user-username"
                className="label"
              >
                {tx("Username")}
              </label>

              <input
                id="new-user-username"
                name="username"
                className="input"
                value={username}
                onChange={(e) => {
                  setUsername(
                    e.target.value,
                  );
                  setError(null);
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
                htmlFor="new-user-password"
                className="label"
              >
                {tx("Password")}
              </label>

              <input
                id="new-user-password"
                name="password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(
                    e.target.value,
                  );
                  setError(null);
                }}
                minLength={6}
                maxLength={128}
                autoComplete="new-password"
                required
                disabled={loading}
              />
            </div>
          </div>

          {/* ROLE */}
          <div>
            <label
              htmlFor="new-user-role"
              className="label"
            >
              {tx("Role")}
            </label>

            <select
              id="new-user-role"
              name="role"
              className="select"
              value={role}
              onChange={(e) => {
                const nextRole =
                  e.target.value as U["role"];

                if (
                  ROLES.includes(nextRole)
                ) {
                  setRole(nextRole);
                  setError(null);
                }
              }}
              disabled={loading}
            >
              <option value="employee">
                {tx("Employee")}
              </option>

              <option value="manager">
                {tx("Manager")}
              </option>

              <option value="admin">
                {tx("Admin")}
              </option>
            </select>
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

          {/* ACTIONS */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost flex-1"
              disabled={loading}
            >
              {tx("Cancel")}
            </button>

            <button
              type="submit"
              className="btn btn-primary flex-1"
              disabled={loading}
              aria-busy={loading}
            >
              {loading
                ? tx("Creating…")
                : tx("Create user")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}