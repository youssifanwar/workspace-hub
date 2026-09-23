"use client";

import { useEffect, useRef, useState } from "react";

type Ticket = {
  id: number;
  ticketNumber: number;
  status:
    | "pending"
    | "printed"
    | "served"
    | "cancelled";
  source: "staff" | "qr";
  customerNote: string | null;
  printedAt: string | null;
  servedAt: string | null;
  createdAt: string;
  bookingId: number;
  deskId: number;
  deskName: string;
  customerName: string;
  customerPhone: string;
  items: {
    id: number;
    name: string;
    quantity: number;
    unitPrice: string;
    note: string | null;
  }[];
  total: number;
};

declare global {
  interface Window {
    wsh?: {
      silentPrint?: (opts: {
        html: string;
        printerName?: string;
        copies?: number;
      }) => Promise<{
        ok: boolean;
        error?: string;
      }>;

      listPrinters?: () => Promise<string[]>;
    };
  }
}

export default function OrdersBoard({
  currency,
  autoPrint,
  kitchenPrinter,
}: {
  currency: string;
  autoPrint: boolean;
  kitchenPrinter: string;
}) {
  const [tickets, setTickets] =
    useState<Ticket[]>([]);

  const [status, setStatus] =
    useState<
      "connecting" | "live" | "offline"
    >("connecting");

  const [soundOn, setSoundOn] =
    useState(true);

  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>(
      typeof window !== "undefined" && "Notification" in window
        ? Notification.permission
        : "default",
    );

  const audioCtxRef =
    useRef<AudioContext | null>(null);

  const printedIdsRef =
    useRef<Set<number>>(new Set());

  const knownTicketIdsRef =
    useRef<Set<number>>(new Set());

  const soundOnRef =
    useRef(true);

  const pollingInFlightRef =
    useRef(false);

  const initializedRef =
    useRef(false);

  /* ---------------------------------------------------------------------- */
  /* LIVE TICKET SYNC                                                        */
  /* ---------------------------------------------------------------------- */

  async function syncTickets() {
    if (pollingInFlightRef.current) {
      return;
    }

    pollingInFlightRef.current = true;

    try {
      const res = await fetch(
        "/api/tickets",
        {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
          },
        },
      );

      if (!res.ok) {
        setStatus("offline");
        return;
      }

      const data = await res.json();
      const nextTickets =
        Array.isArray(data.tickets)
          ? (data.tickets as Ticket[])
          : [];

      const newlyArrived =
        initializedRef.current
          ? nextTickets.filter(
              (ticket) =>
                !knownTicketIdsRef.current.has(
                  ticket.id,
                ) &&
                ticket.status !== "served" &&
                ticket.status !== "cancelled",
            )
          : [];

      setTickets(nextTickets);
      setStatus("live");

      for (const ticket of nextTickets) {
        if (ticket.printedAt) {
          printedIdsRef.current.add(ticket.id);
        }

        knownTicketIdsRef.current.add(ticket.id);
      }

      if (newlyArrived.length > 0) {
        for (const ticket of newlyArrived) {
          if (soundOnRef.current) {
            void playBeep();
          }

          notify(
            ticket.deskName,
            ticket.ticketNumber,
            ticket.items.reduce(
              (sum, item) => sum + item.quantity,
              0,
            ),
          );
        }
      }

      initializedRef.current = true;
    } catch {
      setStatus("offline");
    } finally {
      pollingInFlightRef.current = false;
    }
  }

  useEffect(() => {
    void syncTickets();

    const timer = window.setInterval(() => {
      void syncTickets();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* AUTO PRINT                                                             */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!autoPrint) {
      return;
    }

    (async () => {
      for (const ticket of tickets) {
        if (ticket.printedAt) {
          continue;
        }

        if (
          printedIdsRef.current.has(
            ticket.id,
          )
        ) {
          continue;
        }

        printedIdsRef.current.add(
          ticket.id,
        );

        await printTicket(
          ticket,
          kitchenPrinter,
        );

        try {
          await fetch(
            `/api/tickets/${ticket.id}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                markPrinted:
                  true,
              }),
            },
          );
        } catch {
          /* ignore */
        }
      }
    })();
  }, [
    tickets,
    autoPrint,
    kitchenPrinter,
  ]);

  /* ---------------------------------------------------------------------- */
  /* SOUND                                                                  */
  /* ---------------------------------------------------------------------- */

  async function unlockAudio() {
    try {
      if (
        !audioCtxRef.current
      ) {
        const AudioContextClass =
          window.AudioContext ||
          (
            window as unknown as {
              webkitAudioContext: typeof AudioContext;
            }
          ).webkitAudioContext;

        if (!AudioContextClass) {
          return;
        }

        audioCtxRef.current =
          new AudioContextClass();
      }

      if (
        audioCtxRef.current.state ===
        "suspended"
      ) {
        await audioCtxRef.current.resume();
      }
    } catch {
      /* ignore */
    }
  }

  async function enableAlerts() {
    await unlockAudio();

    // Play a real test beep from the user's click so the browser
    // treats this page as having an allowed audio interaction.
    await playBeep();

    if (
      "Notification" in window
    ) {
      try {
        let permission = Notification.permission;

        if (permission === "default") {
          permission = await Notification.requestPermission();
        }

        setNotificationPermission(permission);
      } catch {
        setNotificationPermission(Notification.permission);
      }
    }
  }

  async function handleAlertsClick() {
    // The alerts button must always run from the user's click.
    // Do not toggle sound off before trying to unlock audio/notifications.
    if (!soundOnRef.current) {
      soundOnRef.current = true;
      setSoundOn(true);
    }

    await enableAlerts();
  }

  async function playBeep() {
    try {
      const context =
        audioCtxRef.current;

      if (!context || context.state !== "running") {
        return;
      }

      const now =
        context.currentTime;

      [
        880,
        1320,
        880,
      ].forEach(
        (frequency, index) => {
          const oscillator =
            context.createOscillator();

          const gain =
            context.createGain();

          const start =
            now + index * 0.18;

          oscillator.type = "sine";
          oscillator.frequency.value =
            frequency;

          gain.gain.setValueAtTime(
            0,
            start,
          );

          gain.gain.linearRampToValueAtTime(
            0.4,
            start + 0.02,
          );

          gain.gain.linearRampToValueAtTime(
            0,
            start + 0.15,
          );

          oscillator
            .connect(gain)
            .connect(context.destination);

          oscillator.start(start);
          oscillator.stop(start + 0.16);
        },
      );
    } catch {
      /* ignore */
    }
  }

  /* ---------------------------------------------------------------------- */
  /* NOTIFICATION                                                           */
  /* ---------------------------------------------------------------------- */

  function notify(
    desk: string,
    ticketNumber: number,
    count: number,
  ) {
    try {
      if (
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        const notification = new Notification(
          `New order · Ticket #${String(
            ticketNumber,
          ).padStart(3, "0")}`,
          {
            body: `${desk} · ${count} item(s)`,
            silent: false,
            requireInteraction: true,
          },
        );

        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  /* ---------------------------------------------------------------------- */
  /* SERVE                                                                  */
  /* ---------------------------------------------------------------------- */

  async function markServed(
    ticket: Ticket,
  ) {
    try {
      await fetch(
        `/api/tickets/${ticket.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            status: "served",
          }),
        },
      );

      const res =
        await fetch(
          "/api/tickets",
          {
            cache:
              "no-store",
          },
        );

      if (res.ok) {
        const data =
          await res.json();

        setTickets(
          Array.isArray(
            data.tickets,
          )
            ? data.tickets
            : [],
        );
      }
    } catch {
      /* ignore */
    }
  }

  /* ---------------------------------------------------------------------- */
  /* REPRINT                                                                */
  /* ---------------------------------------------------------------------- */

  async function reprint(
    ticket: Ticket,
  ) {
    await printTicket(
      ticket,
      kitchenPrinter,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* COUNTS                                                                 */
  /* ---------------------------------------------------------------------- */

  const pending =
    tickets.filter(
      (ticket) =>
        ticket.status !==
          "served" &&
        ticket.status !==
          "cancelled",
    );

  const done =
    tickets.filter(
      (ticket) =>
        ticket.status ===
          "served" ||
        ticket.status ===
          "cancelled",
    );

  /* ---------------------------------------------------------------------- */
  /* MAIN UI                                                                */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="space-y-6">
      {/* HEADER */}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Live Orders
          </h1>

          <p className="text-slate-500">
            QR orders arrive here
            in real-time (every 2 seconds) and print
            automatically.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              void handleAlertsClick();
            }}
            title={
              notificationPermission === "denied"
                ? "Browser notifications are blocked for this site"
                : "Click to test sound and enable notifications"
            }
            className={`btn ${
              soundOn
                ? "btn-primary"
                : "btn-ghost"
            }`}
          >
            {soundOn
              ? notificationPermission === "granted"
                ? "🔊 Sound on"
                : "🔊 Enable alerts"
              : "🔇 Sound off"}
          </button>

          <div
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 ${
              status === "live"
                ? "bg-emerald-50 text-emerald-800"
                : status ===
                    "connecting"
                ? "bg-amber-50 text-amber-800"
                : "bg-red-50 text-red-800"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                status === "live"
                  ? "bg-emerald-500 animate-pulse"
                  : status ===
                      "connecting"
                  ? "bg-amber-500"
                  : "bg-red-500"
              }`}
            />

            {status === "live"
              ? "Live"
              : status ===
                  "connecting"
              ? "Connecting…"
              : "Offline"}
          </div>
        </div>
      </div>

      {/* STAT BOXES */}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBox
          label="Pending"
          value={pending.length}
          icon="⏳"
          color="from-amber-500 to-orange-500"
        />

        <StatBox
          label="Printed"
          value={
            pending.filter(
              (ticket) =>
                ticket.printedAt,
            ).length
          }
          icon="🧾"
          color="from-cyan-500 to-blue-500"
        />

        <StatBox
          label="Served today"
          value={done.length}
          icon="✅"
          color="from-emerald-500 to-teal-500"
        />

        <StatBox
          label="Auto-print"
          value={
            autoPrint
              ? "ON"
              : "OFF"
          }
          icon="🖨️"
          color={
            autoPrint
              ? "from-indigo-500 to-purple-500"
              : "from-slate-500 to-slate-600"
          }
        />
      </div>

      {/* PENDING */}

      <div>
        <h2 className="text-lg font-bold mb-3">
          Pending ({pending.length})
        </h2>

        {pending.length === 0 ? (
          <div className="card p-10 text-center text-slate-400">
            <div className="text-4xl mb-2">
              🎉
            </div>

            All orders served!
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pending.map(
              (ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  currency={
                    currency
                  }
                  allTickets={
                    tickets
                  }
                  onServed={() =>
                    markServed(
                      ticket,
                    )
                  }
                  onReprint={() =>
                    reprint(
                      ticket,
                    )
                  }
                />
              ),
            )}
          </div>
        )}
      </div>

      {/* RECENTLY SERVED */}

      {done.length > 0 && (
        <div>
          <h2 className="text-lg font-bold mb-3">
            Recently served
          </h2>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {done
              .slice(0, 6)
              .map(
                (ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={
                      ticket
                    }
                    currency={
                      currency
                    }
                    allTickets={
                      tickets
                    }
                    onServed={() => {}}
                    onReprint={() =>
                      reprint(
                        ticket,
                      )
                    }
                    muted
                  />
                ),
              )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* STAT BOX                                                                 */
/* ------------------------------------------------------------------------ */

function StatBox({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value:
    | number
    | string;
  icon: string;
  color: string;
}) {
  return (
    <div
      className={`kpi bg-gradient-to-br ${color}`}
    >
      <div className="text-xs uppercase text-white/80 font-semibold">
        {label}
      </div>

      <div className="flex items-end justify-between mt-2">
        <div className="text-2xl font-bold tabular-nums">
          {value}
        </div>

        <div className="text-3xl">
          {icon}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* TICKET DISPLAY NUMBER                                                    */
/* ------------------------------------------------------------------------ */

/*
 * The actual ticketNumber comes from the database.
 *
 * For old/broken data where multiple tickets have the
 * same ticketNumber on the same day, use the unique
 * database id for the visual ticket number.
 *
 * This does NOT modify the database.
 */

function getDisplayTicketNumber(
  ticket: Ticket,
  allTickets: Ticket[],
): number {
  const sameNumberCount =
    allTickets.filter(
      (item) =>
        item.ticketNumber ===
        ticket.ticketNumber,
    ).length;

  if (
    sameNumberCount <= 1
  ) {
    return ticket.ticketNumber;
  }

  return ticket.id;
}

/* ------------------------------------------------------------------------ */
/* TICKET CARD                                                              */
/* ------------------------------------------------------------------------ */

function TicketCard({
  ticket,
  currency,
  allTickets,
  onServed,
  onReprint,
  muted,
}: {
  ticket: Ticket;
  currency: string;
  allTickets: Ticket[];
  onServed: () => void;
  onReprint: () => void;
  muted?: boolean;
}) {
  const displayNumber =
    getDisplayTicketNumber(
      ticket,
      allTickets,
    );

  return (
    <div
      className={`card p-4 ${
        muted
          ? "opacity-60"
          : ""
      } ${
        !ticket.printedAt
          ? "border-amber-300 ring-2 ring-amber-100"
          : ""
      }`}
    >
      {/* TOP */}

      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-xs uppercase text-slate-500 font-semibold">
            Ticket #
            {String(
              displayNumber,
            ).padStart(
              3,
              "0",
            )}
          </div>

          <div className="font-bold text-lg">
            {ticket.deskName}
          </div>

          <div className="text-xs text-slate-500">
            👤{" "}
            {ticket.customerName}{" "}
            ·{" "}
            {new Date(
              ticket.createdAt,
            ).toLocaleTimeString()}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span
            className={`badge ${
              ticket.source ===
              "qr"
                ? "badge-blue"
                : "badge-slate"
            }`}
          >
            {ticket.source ===
            "qr"
              ? "📱 QR"
              : "🧑‍💼 Staff"}
          </span>

          <span
            className={`badge ${
              ticket.status ===
              "served"
                ? "badge-green"
                : ticket.status ===
                    "printed"
                ? "badge-blue"
                : "badge-amber"
            }`}
          >
            {ticket.status}
          </span>
        </div>
      </div>

      {/* ITEMS */}

      <div className="border-t border-slate-100 pt-2 divide-soft">
        {ticket.items.map(
          (item) => (
            <div
              key={item.id}
              className="py-1.5 flex items-start justify-between text-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-indigo-600 tabular-nums">
                    {item.quantity}×
                  </span>

                  <span className="font-semibold truncate">
                    {item.name}
                  </span>
                </div>

                {item.note && (
                  <div className="text-xs text-slate-500 italic pl-6">
                    ✎{" "}
                    {item.note}
                  </div>
                )}
              </div>

              <div className="tabular-nums text-slate-600 text-sm">
                {(
                  item.quantity *
                  Number(
                    item.unitPrice,
                  )
                ).toFixed(2)}
              </div>
            </div>
          ),
        )}
      </div>

      {/* CUSTOMER NOTE */}

      {ticket.customerNote && (
        <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs">
          <b>
            Customer note:
          </b>{" "}
          {ticket.customerNote}
        </div>
      )}

      {/* FOOTER */}

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <div className="font-bold text-slate-800 tabular-nums">
          {ticket.total.toFixed(
            2,
          )}{" "}
          {currency}
        </div>

        <div className="flex gap-1">
          <button
            className="btn btn-ghost !py-1.5 !px-3 text-xs"
            onClick={
              onReprint
            }
          >
            🖨 Reprint
          </button>

          {ticket.status !==
            "served" && (
            <button
              className="btn btn-success !py-1.5 !px-3 text-xs"
              onClick={
                onServed
              }
            >
              ✓ Served
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* PRINT HTML                                                               */
/* ------------------------------------------------------------------------ */

function ticketHtml(
  ticket: Ticket,
  allTickets?: Ticket[],
): string {
  const displayNumber =
    getDisplayTicketNumber(
      ticket,
      allTickets ??
        [ticket],
    );

  const rows = ticket.items
    .map(
      (item) => `
      <div class="row">
        <div class="qty">${item.quantity}×</div>
        <div class="name">
          ${escapeHtml(
            item.name,
          )}
          ${
            item.note
              ? `<div class="note">${escapeHtml(
                  item.note,
                )}</div>`
              : ""
          }
        </div>
      </div>
    `,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Ticket #${displayNumber}</title>

<style>
@page {
  size: 80mm auto;
  margin: 0;
}

body {
  font-family: 'Courier New', monospace;
  font-size: 13px;
  margin: 0;
  padding: 6mm 4mm;
  color: #000;
}

h1 {
  font-size: 28px;
  text-align: center;
  margin: 0 0 4px;
  letter-spacing: 1px;
}

.h {
  text-align: center;
  font-weight: bold;
  font-size: 16px;
  margin-bottom: 2px;
}

.sub {
  text-align: center;
  font-size: 11px;
  margin-bottom: 8px;
}

.rule {
  border-top: 1px dashed #000;
  margin: 6px 0;
}

.row {
  display: flex;
  gap: 6px;
  padding: 3px 0;
  align-items: flex-start;
}

.qty {
  font-weight: bold;
  min-width: 26px;
  font-size: 14px;
}

.name {
  flex: 1;
  font-size: 14px;
}

.note {
  font-style: italic;
  font-size: 11px;
  margin-top: 2px;
}

.footer {
  text-align: center;
  margin-top: 8px;
  font-size: 11px;
}

.tn {
  text-align: center;
  font-size: 32px;
  font-weight: bold;
  letter-spacing: 2px;
  margin: 4px 0;
}
</style>
</head>

<body>

<div class="h">
  KITCHEN ORDER
</div>

<div class="tn">
  #${String(
    displayNumber,
  ).padStart(3, "0")}
</div>

<div class="sub">
  ${escapeHtml(
    ticket.deskName,
  )}
  ·
  ${escapeHtml(
    ticket.customerName,
  )}
</div>

<div class="sub">
  ${new Date(
    ticket.createdAt,
  ).toLocaleString()}
</div>

<div class="rule"></div>

${rows}

<div class="rule"></div>

${
  ticket.customerNote
    ? `
<div style="font-style:italic;font-size:12px;padding:4px 0;">
  Note: ${escapeHtml(
    ticket.customerNote,
  )}
</div>
<div class="rule"></div>
`
    : ""
}

<div class="footer">
  Total items:
  ${ticket.items.reduce(
    (sum, item) =>
      sum + item.quantity,
    0,
  )}
  · Source:
  ${ticket.source.toUpperCase()}
</div>

</body>
</html>`;
}

/* ------------------------------------------------------------------------ */
/* ESCAPE HTML                                                              */
/* ------------------------------------------------------------------------ */

function escapeHtml(
  value: string,
): string {
  return value
    .replace(
      /&/g,
      "&amp;",
    )
    .replace(
      /</g,
      "&lt;",
    )
    .replace(
      />/g,
      "&gt;",
    )
    .replace(
      /"/g,
      "&quot;",
    );
}

/* ------------------------------------------------------------------------ */
/* PRINT                                                                    */
/* ------------------------------------------------------------------------ */

async function printTicket(
  ticket: Ticket,
  printerName: string,
) {
  /*
   * This function doesn't receive the whole ticket list,
   * so printing uses the database ticketNumber unless
   * the ticket itself is already unique.
   *
   * The displayed card uses the fixed number above.
   */

  const html =
    ticketHtml(ticket);

  /* Electron silent print */

  if (
    typeof window !==
      "undefined" &&
    window.wsh?.silentPrint
  ) {
    try {
      await window.wsh.silentPrint(
        {
          html,
          printerName:
            printerName ||
            undefined,
          copies: 1,
        },
      );

      return;
    } catch {
      /* fall through */
    }
  }

  /* Browser print fallback */

  const iframe =
    document.createElement(
      "iframe",
    );

  iframe.style.position =
    "fixed";

  iframe.style.right =
    "0";

  iframe.style.bottom =
    "0";

  iframe.style.width =
    "0";

  iframe.style.height =
    "0";

  iframe.style.border =
    "0";

  document.body.appendChild(
    iframe,
  );

  const doc =
    iframe.contentWindow
      ?.document;

  if (!doc) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      /* ignore */
    }

    setTimeout(() => {
      iframe.remove();
    }, 2000);
  }, 200);
}