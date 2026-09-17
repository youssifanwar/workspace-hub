"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type TicketStatus =
  | "pending"
  | "printed"
  | "served"
  | "cancelled";

type TicketSource = "staff" | "qr";

type TicketItem = {
  id: number;
  name: string;
  quantity: number;
  unitPrice: string;
  note: string | null;
};

type Ticket = {
  id: number;
  ticketNumber: number;
  status: TicketStatus;
  source: TicketSource;
  customerNote: string | null;
  printedAt: string | null;
  servedAt: string | null;
  createdAt: string;
  bookingId: number;
  deskId: number;
  deskName: string;
  customerName: string;
  customerPhone: string;
  items: TicketItem[];
  total: number;
};

type TicketsResponse = {
  tickets: Ticket[];
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  shiftId?: number | string;
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

    webkitAudioContext?: typeof AudioContext;
  }
}

const MAX_TICKETS_RESPONSE_BYTES = 2_000_000;
const MAX_TICKET_ITEMS = 100;
const MAX_TEXT_LENGTH = 2_000;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function safeString(
  value: unknown,
  fallback = "",
  maxLength = MAX_TEXT_LENGTH,
): string {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim().slice(0, maxLength);
}

function safePositiveInteger(
  value: unknown,
  fallback = 0,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number(value)
      : NaN;

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    return fallback;
  }

  return parsed;
}

function safeMoney(
  value: unknown,
  fallback = 0,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number(value)
      : NaN;

  if (
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    return fallback;
  }

  const cents = Math.round(parsed * 100);

  if (!Number.isSafeInteger(cents)) {
    return fallback;
  }

  return cents / 100;
}

function safeDateString(
  value: unknown,
): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  const date = new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function parseTicketItem(
  value: unknown,
): TicketItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = safePositiveInteger(value.id);

  const name = safeString(
    value.name,
    "Unnamed item",
  );

  const quantity = safePositiveInteger(
    value.quantity,
  );

  const unitPriceNumber = safeMoney(
    value.unitPrice,
    0,
  );

  if (id <= 0 || quantity <= 0) {
    return null;
  }

  return {
    id,
    name: name || "Unnamed item",
    quantity,
    unitPrice: unitPriceNumber.toFixed(2),
    note:
      typeof value.note === "string"
        ? value.note
            .trim()
            .slice(0, MAX_TEXT_LENGTH)
        : null,
  };
}

function parseTicket(
  value: unknown,
): Ticket | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = safePositiveInteger(value.id);
  const ticketNumber = safePositiveInteger(
    value.ticketNumber,
  );

  if (id <= 0 || ticketNumber <= 0) {
    return null;
  }

  const rawStatus = value.status;
  const status: TicketStatus =
    rawStatus === "pending" ||
    rawStatus === "printed" ||
    rawStatus === "served" ||
    rawStatus === "cancelled"
      ? rawStatus
      : "pending";

  const rawSource = value.source;
  const source: TicketSource =
    rawSource === "staff" ||
    rawSource === "qr"
      ? rawSource
      : "staff";

  const rawItems = Array.isArray(
    value.items,
  )
    ? value.items
    : [];

  const items = rawItems
    .slice(0, MAX_TICKET_ITEMS)
    .map(parseTicketItem)
    .filter(
      (item): item is TicketItem =>
        item !== null,
    );

  return {
    id,
    ticketNumber,
    status,
    source,
    customerNote:
      typeof value.customerNote === "string"
        ? value.customerNote
            .trim()
            .slice(0, MAX_TEXT_LENGTH)
        : null,
    printedAt:
      typeof value.printedAt === "string"
        ? safeDateString(value.printedAt) ||
          null
        : null,
    servedAt:
      typeof value.servedAt === "string"
        ? safeDateString(value.servedAt) ||
          null
        : null,
    createdAt:
      safeDateString(value.createdAt) ||
      new Date(0).toISOString(),
    bookingId: safePositiveInteger(
      value.bookingId,
    ),
    deskId: safePositiveInteger(
      value.deskId,
    ),
    deskName: safeString(
      value.deskName,
      "Workspace",
    ),
    customerName: safeString(
      value.customerName,
      "Walk-in Customer",
    ),
    customerPhone: safeString(
      value.customerPhone,
      "",
      100,
    ),
    items,
    total: safeMoney(value.total),
  };
}

function parseTickets(
  value: unknown,
): Ticket[] {
  if (!isRecord(value)) {
    return [];
  }

  const rawTickets = Array.isArray(
    value.tickets,
  )
    ? value.tickets
    : [];

  return rawTickets
    .map(parseTicket)
    .filter(
      (ticket): ticket is Ticket =>
        ticket !== null,
    );
}

async function readJsonSafely(
  response: Response,
): Promise<unknown> {
  const contentLength =
    response.headers.get(
      "content-length",
    );

  if (contentLength) {
    const parsedLength = Number(
      contentLength,
    );

    if (
      Number.isFinite(parsedLength) &&
      parsedLength >
        MAX_TICKETS_RESPONSE_BYTES
    ) {
      return null;
    }
  }

  const contentType =
    response.headers.get(
      "content-type",
    ) ?? "";

  if (
    !contentType
      .toLowerCase()
      .includes("application/json")
  ) {
    return null;
  }

  try {
    const text = await response.text();

    if (
      text.length >
      MAX_TICKETS_RESPONSE_BYTES
    ) {
      return null;
    }

    if (!text.trim()) {
      return null;
    }

    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatTicketTime(
  value: string,
): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleTimeString();
}

function formatTicketDateTime(
  value: string,
): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
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

  const [
    connectionStatus,
    setConnectionStatus,
  ] = useState<
    "connecting" | "live" | "offline"
  >("connecting");

  const [soundOn, setSoundOn] =
    useState(true);

  const [busyTicketIds, setBusyTicketIds] =
    useState<Set<number>>(
      new Set(),
    );

  const audioCtxRef =
    useRef<AudioContext | null>(null);

  const printedIdsRef =
    useRef<Set<number>>(new Set());

  const printingIdsRef =
    useRef<Set<number>>(new Set());

  const mountedRef =
    useRef(true);

  const refreshInFlightRef =
    useRef(false);

  const playBeep = useCallback(
    async () => {
      try {
        if (
          typeof window === "undefined"
        ) {
          return;
        }

        const AudioContextClass =
          window.AudioContext ||
          window.webkitAudioContext;

        if (!AudioContextClass) {
          return;
        }

        if (
          !audioCtxRef.current ||
          audioCtxRef.current.state ===
            "closed"
        ) {
          audioCtxRef.current =
            new AudioContextClass();
        }

        const context =
          audioCtxRef.current;

        if (context.state === "suspended") {
          try {
            await context.resume();
          } catch {
            return;
          }
        }

        if (context.state !== "running") {
          return;
        }

        const now =
          context.currentTime;

        [880, 1320, 880].forEach(
          (frequency, index) => {
            const oscillator =
              context.createOscillator();

            const gain =
              context.createGain();

            const start =
              now + index * 0.18;

            oscillator.type = "sine";

            oscillator.frequency.setValueAtTime(
              frequency,
              start,
            );

            gain.gain.setValueAtTime(
              0,
              start,
            );

            gain.gain.linearRampToValueAtTime(
              0.3,
              start + 0.02,
            );

            gain.gain.linearRampToValueAtTime(
              0,
              start + 0.15,
            );

            oscillator
              .connect(gain)
              .connect(
                context.destination,
              );

            oscillator.start(start);

            oscillator.stop(
              start + 0.16,
            );
          },
        );
      } catch {
        // Audio is optional.
      }
    },
    [],
  );

  const fetchTickets = useCallback(
    async (
      options?: {
        markOfflineOnError?: boolean;
      },
    ) => {
      if (refreshInFlightRef.current) {
        return null;
      }

      refreshInFlightRef.current = true;

      try {
        const response =
          await fetch(
            "/api/tickets",
            {
              method: "GET",
              cache: "no-store",
              headers: {
                Accept:
                  "application/json",
              },
            },
          );

        const payload =
          await readJsonSafely(
            response,
          );

        if (!response.ok) {
          if (
            mountedRef.current &&
            options?.markOfflineOnError
          ) {
            setConnectionStatus(
              "offline",
            );
          }

          return null;
        }

        const nextTickets =
          parseTickets(payload);

        if (mountedRef.current) {
          setTickets(nextTickets);

          for (const ticket of nextTickets) {
            if (ticket.printedAt) {
              printedIdsRef.current.add(
                ticket.id,
              );
            }
          }
        }

        return nextTickets;
      } catch {
        if (
          mountedRef.current &&
          options?.markOfflineOnError
        ) {
          setConnectionStatus(
            "offline",
          );
        }

        return null;
      } finally {
        refreshInFlightRef.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;

    void fetchTickets({
      markOfflineOnError: true,
    });

    return () => {
      mountedRef.current = false;
    };
  }, [fetchTickets]);

  useEffect(() => {
    let active = true;

    const eventSource =
      new EventSource(
        "/api/events",
      );

    const handleOpen = () => {
      if (!active) {
        return;
      }

      setConnectionStatus("live");
    };

    const handleError = () => {
      if (!active) {
        return;
      }

      setConnectionStatus("offline");
    };

    const handleMessage = async (
      event: MessageEvent,
    ) => {
      if (!active) {
        return;
      }

      if (
        typeof event.data !==
          "string" ||
        event.data.length === 0 ||
        event.data.length >
          100_000
      ) {
        return;
      }

      try {
        const parsed =
          JSON.parse(
            event.data,
          );

        if (
          !isRecord(parsed) ||
          parsed.type !== "new_order"
        ) {
          return;
        }

        if (soundOn) {
          void playBeep();
        }

        await fetchTickets();
      } catch {
        // Ignore malformed events.
      }
    };

    eventSource.onopen =
      handleOpen;

    eventSource.onerror =
      handleError;

    eventSource.onmessage =
      handleMessage;

    return () => {
      active = false;
      eventSource.close();
    };
  }, [
    fetchTickets,
    playBeep,
    soundOn,
  ]);

  useEffect(() => {
    if (!autoPrint) {
      return;
    }

    let cancelled = false;

    async function processPrinting() {
      for (const ticket of tickets) {
        if (cancelled) {
          return;
        }

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

        if (
          printingIdsRef.current.has(
            ticket.id,
          )
        ) {
          continue;
        }

        printingIdsRef.current.add(
          ticket.id,
        );

        try {
          const printed =
            await printTicket(
              ticket,
              kitchenPrinter,
            );

          if (
            cancelled ||
            !mountedRef.current
          ) {
            return;
          }

          if (!printed) {
            continue;
          }

          const response =
            await fetch(
              `/api/tickets/${ticket.id}`,
              {
                method: "PATCH",
                headers: {
                  "Content-Type":
                    "application/json",
                  Accept:
                    "application/json",
                },
                cache: "no-store",
                body: JSON.stringify({
                  markPrinted: true,
                }),
              },
            );

          if (!response.ok) {
            continue;
          }

          const payload =
            await readJsonSafely(
              response,
            );

          if (
            payload !== null &&
            isRecord(payload) &&
            payload.ok === false
          ) {
            continue;
          }

          printedIdsRef.current.add(
            ticket.id,
          );

          setTickets((current) =>
            current.map((item) =>
              item.id === ticket.id
                ? {
                    ...item,
                    status:
                      item.status ===
                        "pending"
                        ? "printed"
                        : item.status,
                    printedAt:
                      new Date().toISOString(),
                  }
                : item,
            ),
          );
        } catch {
          // Leave the ticket unprinted so a future refresh can retry.
        } finally {
          printingIdsRef.current.delete(
            ticket.id,
          );
        }
      }
    }

    void processPrinting();

    return () => {
      cancelled = true;
    };
  }, [
    tickets,
    autoPrint,
    kitchenPrinter,
  ]);

  useEffect(() => {
    return () => {
      const context =
        audioCtxRef.current;

      audioCtxRef.current = null;

      if (context) {
        void context
          .close()
          .catch(() => {
            // Ignore cleanup errors.
          });
      }
    };
  }, []);

  async function markServed(
    ticket: Ticket,
  ) {
    if (
      busyTicketIds.has(ticket.id) ||
      ticket.status === "served" ||
      ticket.status === "cancelled"
    ) {
      return;
    }

    setBusyTicketIds((current) => {
      const next = new Set(current);
      next.add(ticket.id);
      return next;
    });

    try {
      const response =
        await fetch(
          `/api/tickets/${ticket.id}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
              Accept:
                "application/json",
            },
            cache: "no-store",
            body: JSON.stringify({
              status: "served",
            }),
          },
        );

      const payload =
        await readJsonSafely(
          response,
        );

      if (!response.ok) {
        throw new Error(
          isRecord(payload) &&
          typeof payload.error ===
            "string"
            ? payload.error
            : "Failed to mark ticket as served.",
        );
      }

      if (
        isRecord(payload) &&
        payload.ok === false
      ) {
        throw new Error(
          typeof payload.error ===
            "string"
            ? payload.error
            : "Failed to mark ticket as served.",
        );
      }

      if (mountedRef.current) {
        setTickets((current) =>
          current.map((item) =>
            item.id === ticket.id
              ? {
                  ...item,
                  status: "served",
                  servedAt:
                    new Date().toISOString(),
                }
              : item,
          ),
        );
      }
    } catch {
      await fetchTickets({
        markOfflineOnError: false,
      });
    } finally {
      if (mountedRef.current) {
        setBusyTicketIds((current) => {
          const next = new Set(
            current,
          );
          next.delete(ticket.id);
          return next;
        });
      }
    }
  }

  async function reprint(
    ticket: Ticket,
  ) {
    if (
      busyTicketIds.has(ticket.id)
    ) {
      return;
    }

    setBusyTicketIds((current) => {
      const next = new Set(current);
      next.add(ticket.id);
      return next;
    });

    try {
      await printTicket(
        ticket,
        kitchenPrinter,
      );
    } finally {
      if (mountedRef.current) {
        setBusyTicketIds((current) => {
          const next = new Set(
            current,
          );
          next.delete(ticket.id);
          return next;
        });
      }
    }
  }

  const pending =
    tickets.filter(
      (ticket) =>
        ticket.status !== "served" &&
        ticket.status !== "cancelled",
    );

  const done =
    tickets.filter(
      (ticket) =>
        ticket.status === "served" ||
        ticket.status === "cancelled",
    );

  const printedPendingCount =
    pending.filter(
      (ticket) => Boolean(ticket.printedAt),
    ).length;

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Live Orders
          </h1>

          <p className="text-slate-500">
            QR orders arrive here in
            real-time and print
            automatically.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setSoundOn(
                (value) => !value,
              )
            }
            className={`btn ${
              soundOn
                ? "btn-primary"
                : "btn-ghost"
            }`}
            aria-pressed={soundOn}
          >
            {soundOn
              ? "🔊 Sound on"
              : "🔇 Sound off"}
          </button>

          <div
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 ${
              connectionStatus ===
              "live"
                ? "bg-emerald-50 text-emerald-800"
                : connectionStatus ===
                  "connecting"
                ? "bg-amber-50 text-amber-800"
                : "bg-red-50 text-red-800"
            }`}
            role="status"
            aria-live="polite"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                connectionStatus ===
                "live"
                  ? "bg-emerald-500 animate-pulse"
                  : connectionStatus ===
                    "connecting"
                  ? "bg-amber-500"
                  : "bg-red-500"
              }`}
              aria-hidden="true"
            />

            {connectionStatus ===
            "live"
              ? "Live"
              : connectionStatus ===
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
          value={printedPendingCount}
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
            <div
              className="text-4xl mb-2"
              aria-hidden="true"
            >
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
                  currency={currency}
                  allTickets={tickets}
                  busy={
                    busyTicketIds.has(
                      ticket.id,
                    )
                  }
                  onServed={() =>
                    void markServed(
                      ticket,
                    )
                  }
                  onReprint={() =>
                    void reprint(
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
                    ticket={ticket}
                    currency={currency}
                    allTickets={tickets}
                    busy={
                      busyTicketIds.has(
                        ticket.id,
                      )
                    }
                    onServed={() => {}}
                    onReprint={() =>
                      void reprint(
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
  value: number | string;
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

      <div className="flex items-end justify-between mt-2 gap-2">
        <div className="text-2xl font-bold tabular-nums">
          {value}
        </div>

        <div
          className="text-3xl"
          aria-hidden="true"
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* TICKET DISPLAY NUMBER                                                    */
/* ------------------------------------------------------------------------ */

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

  if (sameNumberCount <= 1) {
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
  busy,
  muted,
}: {
  ticket: Ticket;
  currency: string;
  allTickets: Ticket[];
  onServed: () => void;
  onReprint: () => void;
  busy: boolean;
  muted?: boolean;
}) {
  const displayNumber =
    getDisplayTicketNumber(
      ticket,
      allTickets,
    );

  const isCancelled =
    ticket.status === "cancelled";

  const statusClass =
    ticket.status === "served"
      ? "badge-green"
      : ticket.status === "printed"
      ? "badge-blue"
      : isCancelled
      ? "badge-slate"
      : "badge-amber";

  return (
    <div
      className={`card p-4 ${
        muted ? "opacity-60" : ""
      } ${
        !ticket.printedAt &&
        !isCancelled
          ? "border-amber-300 ring-2 ring-amber-100"
          : ""
      }`}
    >
      {/* TOP */}
      <div className="flex items-start justify-between mb-2 gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase text-slate-500 font-semibold">
            Ticket #
            {String(
              displayNumber,
            ).padStart(3, "0")}
          </div>

          <div className="font-bold text-lg truncate">
            {ticket.deskName ||
              "Workspace"}
          </div>

          <div className="text-xs text-slate-500 truncate">
            👤{" "}
            {ticket.customerName ||
              "Walk-in Customer"}{" "}
            ·{" "}
            {formatTicketTime(
              ticket.createdAt,
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`badge ${
              ticket.source === "qr"
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
            className={`badge ${statusClass}`}
          >
            {ticket.status}
          </span>
        </div>
      </div>

      {/* ITEMS */}
      <div className="border-t border-slate-100 pt-2 divide-soft">
        {ticket.items.length ===
        0 ? (
          <div className="py-2 text-xs text-slate-400">
            No items
          </div>
        ) : (
          ticket.items.map(
            (item) => {
              const quantity =
                safePositiveInteger(
                  item.quantity,
                );

              const unitPrice =
                safeMoney(
                  item.unitPrice,
                );

              const lineTotal =
                Math.round(
                  quantity *
                    unitPrice *
                    100,
                ) / 100;

              return (
                <div
                  key={item.id}
                  className="py-1.5 flex items-start justify-between text-sm gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-indigo-600 tabular-nums shrink-0">
                        {quantity}×
                      </span>

                      <span className="font-semibold truncate">
                        {item.name ||
                          "Unnamed item"}
                      </span>
                    </div>

                    {item.note && (
                      <div className="text-xs text-slate-500 italic pl-6 break-words">
                        ✎ {item.note}
                      </div>
                    )}
                  </div>

                  <div className="tabular-nums text-slate-600 text-sm shrink-0">
                    {lineTotal.toFixed(
                      2,
                    )}
                  </div>
                </div>
              );
            },
          )
        )}
      </div>

      {/* CUSTOMER NOTE */}
      {ticket.customerNote && (
        <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs break-words">
          <b>
            Customer note:
          </b>{" "}
          {ticket.customerNote}
        </div>
      )}

      {/* FOOTER */}
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 gap-3">
        <div className="font-bold text-slate-800 tabular-nums shrink-0">
          {safeMoney(
            ticket.total,
          ).toFixed(2)}{" "}
          {currency}
        </div>

        <div className="flex gap-1 flex-wrap justify-end">
          <button
            type="button"
            className="btn btn-ghost !py-1.5 !px-3 text-xs"
            onClick={onReprint}
            disabled={busy}
          >
            {busy
              ? "Printing…"
              : "🖨 Reprint"}
          </button>

          {ticket.status !==
            "served" &&
            ticket.status !==
              "cancelled" && (
              <button
                type="button"
                className="btn btn-success !py-1.5 !px-3 text-xs"
                onClick={onServed}
                disabled={busy}
              >
                {busy
                  ? "Saving…"
                  : "✓ Served"}
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
  allTickets: Ticket[] = [ticket],
): string {
  const displayNumber =
    getDisplayTicketNumber(
      ticket,
      allTickets,
    );

  const rows = ticket.items
    .map(
      (item) => {
        const quantity =
          safePositiveInteger(
            item.quantity,
          );

        const note =
          item.note
            ? `<div class="note">${escapeHtml(
                item.note,
              )}</div>`
            : "";

        return `
      <div class="row">
        <div class="qty">${quantity}×</div>
        <div class="name">
          ${escapeHtml(
            item.name ||
              "Unnamed item",
          )}
          ${note}
        </div>
      </div>
    `;
      },
    )
    .join("");

  const totalItems =
    ticket.items.reduce(
      (sum, item) =>
        sum +
        safePositiveInteger(
          item.quantity,
        ),
      0,
    );

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Ticket #${String(
    displayNumber,
  ).padStart(3, "0")}</title>

<style>
@page {
  size: 80mm auto;
  margin: 0;
}

* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
}

body {
  font-family: "Courier New", monospace;
  font-size: 13px;
  margin: 0;
  padding: 6mm 4mm;
  color: #000;
  background: #fff;
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
  word-break: break-word;
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
  word-break: break-word;
}

.note {
  font-style: italic;
  font-size: 11px;
  margin-top: 2px;
  word-break: break-word;
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
    ticket.deskName ||
      "Workspace",
  )}
  ·
  ${escapeHtml(
    ticket.customerName ||
      "Walk-in Customer",
  )}
</div>

<div class="sub">
  ${escapeHtml(
    formatTicketDateTime(
      ticket.createdAt,
    ),
  )}
</div>

<div class="rule"></div>

${rows}

<div class="rule"></div>

${
  ticket.customerNote
    ? `
<div style="font-style:italic;font-size:12px;padding:4px 0;word-break:break-word;">
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
  ${totalItems}
  · Source:
  ${escapeHtml(
    ticket.source.toUpperCase(),
  )}
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
    )
    .replace(
      /'/g,
      "&#039;",
    );
}

/* ------------------------------------------------------------------------ */
/* PRINT                                                                    */
/* ------------------------------------------------------------------------ */

async function printTicket(
  ticket: Ticket,
  printerName: string,
): Promise<boolean> {
  const html =
    ticketHtml(ticket);

  /* Electron silent print */
  if (
    typeof window !==
      "undefined" &&
    typeof window.wsh
      ?.silentPrint ===
      "function"
  ) {
    try {
      const result =
        await window.wsh.silentPrint({
          html,
          printerName:
            printerName.trim() ||
            undefined,
          copies: 1,
        });

      if (result?.ok) {
        return true;
      }
    } catch {
      // Fall through to browser print.
    }
  }

  /* Browser print fallback */
  if (
    typeof document ===
      "undefined"
  ) {
    return false;
  }

  const iframe =
    document.createElement(
      "iframe",
    );

  iframe.setAttribute(
    "aria-hidden",
    "true",
  );

  iframe.style.position =
    "fixed";

  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents =
    "none";

  document.body.appendChild(
    iframe,
  );

  const doc =
    iframe.contentWindow
      ?.document;

  if (!doc) {
    iframe.remove();
    return false;
  }

  try {
    doc.open();
    doc.write(html);
    doc.close();

    await new Promise<void>(
      (resolve) => {
        window.setTimeout(
          () => resolve(),
          200,
        );
      },
    );

    const printWindow =
      iframe.contentWindow;

    if (!printWindow) {
      iframe.remove();
      return false;
    }

    printWindow.focus();
    printWindow.print();

    window.setTimeout(() => {
      iframe.remove();
    }, 2000);

    return true;
  } catch {
    iframe.remove();
    return false;
  }
}