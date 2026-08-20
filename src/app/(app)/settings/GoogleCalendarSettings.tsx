"use client";

import { useEffect, useState } from "react";

type StatusResponse = {
  connected: boolean;
  email?: string | null;
};

type ApiResponse = {
  ok?: boolean;
  url?: string;
  error?: string;
};

export default function GoogleCalendarSettings() {
  const [status, setStatus] =
    useState<StatusResponse>({
      connected: false,
      email: null,
    });

  const [loading, setLoading] =
    useState(true);

  const [connecting, setConnecting] =
    useState(false);

  const [disconnecting, setDisconnecting] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [success, setSuccess] =
    useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // LOAD STATUS
  // ---------------------------------------------------------------------------

  async function loadStatus() {
    try {
      const res = await fetch(
        "/api/google-calendar/status",
        {
          cache: "no-store",
        },
      );

      const data =
        (await res.json().catch(
          () => ({}),
        )) as StatusResponse & {
          error?: string;
        };

      if (!res.ok) {
        setError(
          data.error ||
            `Status request failed (HTTP ${res.status})`,
        );

        return null;
      }

      const nextStatus = {
        connected:
          Boolean(data.connected),
        email:
          data.email ?? null,
      };

      setStatus(
        nextStatus,
      );

      return nextStatus;
    } catch (err) {
      console.error(
        "Google Calendar status error:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Could not check Google Calendar status.",
      );

      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // INITIAL LOAD
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        if (mounted) {
          setLoading(true);
        }

        await loadStatus();
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void init();

    return () => {
      mounted = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // CONNECT
  //
  // IMPORTANT:
  // Do NOT set window.location.href = Google URL.
  //
  // The API already opens Google in the system browser.
  // The Electron app must stay open.
  // ---------------------------------------------------------------------------

  async function connect() {
    if (connecting) {
      return;
    }

    setConnecting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(
        "/api/google-calendar/auth",
        {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      const data =
        (await res.json().catch(
          () => ({}),
        )) as ApiResponse;

      console.log(
        "Google Calendar auth response:",
        data,
      );

      if (
        !res.ok ||
        !data.url
      ) {
        setError(
          data.error ||
            `Could not start Google Calendar connection (HTTP ${res.status})`,
        );

        setConnecting(false);
        return;
      }

      setSuccess(
        "Google sign-in opened. Complete the authorization in the browser…",
      );

      // ---------------------------------------------------------------------
      // POLL CONNECTION STATUS
      //
      // After Google authorization finishes, the backend saves the token.
      // We keep checking until connected.
      // ---------------------------------------------------------------------

      const startedAt =
        Date.now();

      const timeoutMs =
        2 * 60 * 1000;

      const poll =
        async (): Promise<void> => {
          if (
            Date.now() -
              startedAt >
            timeoutMs
          ) {
            setConnecting(false);

            setSuccess(null);

            setError(
              "Google authorization timed out. Please try Connect again.",
            );

            return;
          }

          const nextStatus =
            await loadStatus();

          if (
            nextStatus?.connected
          ) {
            setConnecting(false);
            setSuccess(
              `Google Calendar connected${
                nextStatus.email
                  ? `: ${nextStatus.email}`
                  : ""
              }`,
            );

            return;
          }

          setTimeout(
            () => {
              void poll();
            },
            1000,
          );
        };

      setTimeout(
        () => {
          void poll();
        },
        1000,
      );
    } catch (err) {
      console.error(
        "Google Calendar connect error:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Could not start Google Calendar connection.",
      );

      setConnecting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // DISCONNECT
  // ---------------------------------------------------------------------------

  async function disconnect() {
    if (disconnecting) {
      return;
    }

    if (
      !window.confirm(
        "Disconnect Google Calendar from WorkSpace Hub?",
      )
    ) {
      return;
    }

    setDisconnecting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(
        "/api/google-calendar/disconnect",
        {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      const data =
        await res.json().catch(
          () => ({}),
        );

      if (!res.ok) {
        setError(
          data.error ||
            `Disconnect failed (HTTP ${res.status})`,
        );

        return;
      }

      setStatus({
        connected: false,
        email: null,
      });

      setSuccess(
        "Google Calendar disconnected successfully.",
      );
    } catch (err) {
      console.error(
        "Google Calendar disconnect error:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Could not disconnect Google Calendar.",
      );
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-4">

      {/* ------------------------------------------------------------------- */}
      {/* HEADER                                                              */}
      {/* ------------------------------------------------------------------- */}

      <div className="flex items-center justify-between gap-4 flex-wrap">

        <div>
          <div className="font-semibold text-slate-800">
            Google Calendar
          </div>

          <div className="text-sm text-slate-500">
            Use Google Calendar to manage
            meeting-room availability and
            reservations.
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">
            Checking connection…
          </div>
        ) : status.connected ? (
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            Connected
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
            Not connected
          </div>
        )}

      </div>

      {/* ------------------------------------------------------------------- */}
      {/* CONNECTED                                                          */}
      {/* ------------------------------------------------------------------- */}

      {status.connected ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">

          <div className="text-sm text-emerald-800">

            <div className="font-bold">
              Google account connected
            </div>

            {status.email && (
              <div className="mt-1 break-all">
                {status.email}
              </div>
            )}

          </div>

          <button
            type="button"
            onClick={
              disconnect
            }
            disabled={
              disconnecting
            }
            className="btn btn-ghost mt-3 text-red-600 disabled:opacity-50"
          >
            {disconnecting
              ? "Disconnecting…"
              : "Disconnect"}
          </button>

        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">

          <div className="text-sm text-slate-600 mb-3">
            Connect the Gmail account you
            created for the workspace.
          </div>

          <button
            type="button"
            onClick={connect}
            disabled={
              loading ||
              connecting
            }
            className="btn btn-primary disabled:opacity-50"
          >
            {connecting
              ? "Waiting for Google authorization…"
              : "Connect Google Calendar"}
          </button>

        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* SUCCESS                                                             */}
      {/* ------------------------------------------------------------------- */}

      {success && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-sm text-emerald-700 whitespace-pre-wrap">
          {success}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* ERROR                                                               */}
      {/* ------------------------------------------------------------------- */}

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700 whitespace-pre-wrap break-words">
          {error}
        </div>
      )}

    </div>
  );
}