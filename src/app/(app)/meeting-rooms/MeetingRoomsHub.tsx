"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import ActiveMeetingRooms from "./ActiveMeetingRooms";
import ConfirmDialog from "./ConfirmDialog";
import ReservationDialog from "./ReservationDialog";
import StartNowDialog from "./StartNowDialog";

export type HubRoom = {
  id: number;
  name: string;
  hourlyRate: string;
  capacity: number;
  pricingTiers: Array<{
    id: number;
    minPeople: number;
    maxPeople: number;
    hourlyRate: string;
    active: boolean;
  }>;
};

export type HubReservation = {
  id: number;
  deskId: number;
  roomName: string;
  customerName: string;
  customerPhone: string | null;
  startAt: string;
  endAt: string;
  status: "confirmed" | "active";
  attendeeCount: number;
  usesPackage: boolean;
};

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function MeetingRoomsHub({
  rooms,
  reservations,
  currency,
  timeZone,
  earlyCheckinMinutes,
  maxBookingHours,
}: {
  rooms: HubRoom[];
  reservations: HubReservation[];
  currency: string;
  timeZone: string;
  earlyCheckinMinutes: number;
  maxBookingHours: number;
}) {
  const router = useRouter();
  const now = useNow();

  const [booking, setBooking] = useState<{
    roomId: number | null;
    start: Date;
  } | null>(null);
  const [startNow, setStartNow] = useState<{ roomId: number | null } | null>(
    null,
  );
  const [toCancel, setToCancel] = useState<HubReservation | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState<number | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const fmtTime = (iso: string | number) =>
    new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
  const dayKey = (iso: string) =>
    new Date(iso).toLocaleDateString("en-CA", { timeZone });
  const todayKey = new Date(now).toLocaleDateString("en-CA", { timeZone });
  const tomorrowKey = new Date(now + 86_400_000).toLocaleDateString("en-CA", {
    timeZone,
  });
  const dayLabel = (key: string, iso: string) =>
    key === todayKey
      ? "Today"
      : key === tomorrowKey
        ? "Tomorrow"
        : new Date(iso).toLocaleDateString([], {
            weekday: "long",
            day: "numeric",
            month: "short",
            timeZone,
          });

  function nextSlotStart(): Date {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
  }

  const roomState = useMemo(() => {
    return rooms.map((room) => {
      const mine = reservations.filter((r) => r.deskId === room.id);
      const current = mine.find(
        (r) =>
          r.status === "active" ||
          (new Date(r.startAt).getTime() <= now &&
            new Date(r.endAt).getTime() > now &&
            r.status === "confirmed"),
      );
      const next = mine
        .filter(
          (r) =>
            r.status === "confirmed" && new Date(r.startAt).getTime() > now,
        )
        .sort(
          (a, b) =>
            new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
        )[0];
      const activeTiers = room.pricingTiers.filter((t) => t.active);
      const rates = (
        activeTiers.length ? activeTiers.map((t) => t.hourlyRate) : [room.hourlyRate]
      )
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      return {
        room,
        current,
        next,
        fromRate: rates.length ? Math.min(...rates) : null,
      };
    });
  }, [rooms, reservations, now]);

  const inUse = roomState.filter((r) => r.current?.status === "active").length;
  const upcoming = useMemo(
    () =>
      reservations
        .filter(
          (r) =>
            r.status === "confirmed" && new Date(r.endAt).getTime() > now,
        )
        .sort(
          (a, b) =>
            new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
        ),
    [reservations, now],
  );
  const todayCount = upcoming.filter((r) => dayKey(r.startAt) === todayKey)
    .length;

  const grouped = useMemo(() => {
    const map = new Map<string, HubReservation[]>();
    for (const r of upcoming) {
      const k = dayKey(r.startAt);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return Array.from(map.entries());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming, timeZone]);

  async function checkIn(r: HubReservation) {
    if (checkingIn !== null) return;
    setCheckingIn(r.id);
    try {
      const res = await fetch(`/api/meeting-rooms/reservations/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_in" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({
          kind: "error",
          text: data?.error || `Could not check in (HTTP ${res.status}).`,
        });
        return;
      }
      setNotice({
        kind: "success",
        text: `${r.customerName} is checked in to ${r.roomName}.`,
      });
      router.refresh();
    } catch {
      setNotice({ kind: "error", text: "Network error. Please try again." });
    } finally {
      setCheckingIn(null);
    }
  }

  async function confirmCancel() {
    if (!toCancel || cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(
        `/api/meeting-rooms/reservations/${toCancel.id}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCancelError(
          data?.error || `Could not cancel the reservation (HTTP ${res.status}).`,
        );
        return;
      }
      setNotice({
        kind: "success",
        text: `Reservation for ${toCancel.customerName} was cancelled.${
          toCancel.usesPackage ? " Package hours were returned." : ""
        }`,
      });
      setToCancel(null);
      router.refresh();
    } catch {
      setCancelError("Network error. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            Meeting Rooms
          </h1>
          <p className="text-slate-500 mt-1">
            Reserve rooms, check customers in, and manage today&apos;s schedule.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/meeting-rooms/calendar" className="btn btn-ghost">
            📅 Calendar
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={rooms.length === 0}
            onClick={() => setStartNow({ roomId: null })}
          >
            ⚡ Walk-in
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={rooms.length === 0}
            onClick={() => setBooking({ roomId: null, start: nextSlotStart() })}
          >
            + New reservation
          </button>
        </div>
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`rounded-xl border px-4 py-3 text-sm font-medium flex items-start justify-between gap-3 ${
            notice.kind === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="opacity-60 hover:opacity-100"
            onClick={() => setNotice(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Rooms" value={rooms.length} />
        <Stat label="In use now" value={inUse} tone="indigo" />
        <Stat
          label="Available now"
          value={Math.max(0, rooms.length - inUse)}
          tone="green"
        />
        <Stat label="Upcoming today" value={todayCount} />
      </div>

      {/* Rooms */}
      <section>
        <h2 className="text-lg font-bold text-slate-900 mb-3">Rooms</h2>
        {rooms.length === 0 ? (
          <div className="card p-10 text-center text-slate-500">
            No meeting rooms yet. Add one in Settings → Desks.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {roomState.map(({ room, current, next, fromRate }) => {
              const busy = current?.status === "active";
              return (
                <article
                  key={room.id}
                  className="card p-5 flex flex-col gap-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold text-slate-900 truncate">
                        {room.name}
                      </h3>
                      <p className="text-sm text-slate-500">
                        Up to {room.capacity} people
                        {fromRate !== null
                          ? ` · from ${fromRate.toFixed(0)} ${currency}/h`
                          : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        busy
                          ? "bg-indigo-50 text-indigo-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          busy ? "bg-indigo-500" : "bg-emerald-500"
                        }`}
                      />
                      {busy ? "In use" : "Available"}
                    </span>
                  </div>

                  <div className="text-sm text-slate-600 min-h-[40px]">
                    {current ? (
                      <>
                        <div className="font-semibold text-slate-800">
                          {current.customerName}
                        </div>
                        <div className="text-slate-500">
                          Until {fmtTime(current.endAt)}
                        </div>
                      </>
                    ) : next ? (
                      <>
                        <div className="text-slate-500">Next reservation</div>
                        <div className="font-semibold text-slate-800">
                          {fmtTime(next.startAt)} · {next.customerName}
                        </div>
                      </>
                    ) : (
                      <div className="text-slate-400">
                        Nothing scheduled
                      </div>
                    )}
                  </div>

                  <div className="mt-auto grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => setStartNow({ roomId: room.id })}
                    >
                      ⚡ Start now
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() =>
                        setBooking({ roomId: room.id, start: nextSlotStart() })
                      }
                    >
                      Reserve
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* In the room now */}
      <ActiveMeetingRooms currency={currency} />

      {/* Upcoming */}
      <section>
        <h2 className="text-lg font-bold text-slate-900 mb-3">
          Upcoming reservations
        </h2>
        {grouped.length === 0 ? (
          <div className="card p-10 text-center text-slate-500">
            No upcoming reservations.
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([key, items]) => (
              <div key={key}>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
                  {dayLabel(key, items[0].startAt)}
                </div>
                <div className="card divide-soft overflow-hidden">
                  {items.map((r) => {
                    const startMs = new Date(r.startAt).getTime();
                    const opensAt = startMs - earlyCheckinMinutes * 60_000;
                    const canCheckIn = now >= opensAt;
                    return (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4"
                      >
                        <div className="w-28 shrink-0">
                          <div className="font-bold text-slate-900 tabular-nums">
                            {fmtTime(r.startAt)}
                          </div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            to {fmtTime(r.endAt)}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1 basis-48">
                          <div className="font-semibold text-slate-900 truncate">
                            {r.customerName}
                          </div>
                          <div className="text-sm text-slate-500 truncate">
                            {r.roomName} · {r.attendeeCount}{" "}
                            {r.attendeeCount === 1 ? "person" : "people"}
                            {r.customerPhone ? ` · ${r.customerPhone}` : ""}
                          </div>
                        </div>
                        {r.usesPackage && (
                          <span className="rounded-full bg-violet-50 text-violet-700 text-xs font-semibold px-2.5 py-1">
                            Package
                          </span>
                        )}
                        <div className="flex gap-2 ml-auto">
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={!canCheckIn || checkingIn !== null}
                            title={
                              canCheckIn
                                ? undefined
                                : `Check-in opens at ${fmtTime(opensAt)}`
                            }
                            onClick={() => void checkIn(r)}
                          >
                            {checkingIn === r.id ? "Checking in…" : "Check in"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost text-rose-600"
                            onClick={() => {
                              setCancelError(null);
                              setToCancel(r);
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {booking && (
        <ReservationDialog
          rooms={rooms.map((r) => ({
            id: r.id,
            name: r.name,
            capacity: r.capacity,
          }))}
          currency={currency}
          initialRoomId={booking.roomId}
          initialStart={booking.start}
          maxDurationHours={maxBookingHours}
          timeZone={timeZone}
          onClose={() => setBooking(null)}
        />
      )}

      {startNow && (
        <StartNowDialog
          rooms={rooms.map((r) => ({
            id: r.id,
            name: r.name,
            capacity: r.capacity,
          }))}
          occupancy={reservations.map((r) => ({
            deskId: r.deskId,
            startAt: r.startAt,
            endAt: r.endAt,
            status: r.status,
          }))}
          currency={currency}
          initialRoomId={startNow.roomId}
          maxDurationHours={maxBookingHours}
          timeZone={timeZone}
          onClose={() => setStartNow(null)}
          onStarted={(text) => setNotice({ kind: "success", text })}
        />
      )}

      {toCancel && (
        <ConfirmDialog
          title="Cancel this reservation?"
          message={
            <>
              <b>{toCancel.customerName}</b> · {toCancel.roomName}
              <br />
              {fmtTime(toCancel.startAt)} – {fmtTime(toCancel.endAt)}
              {toCancel.usesPackage && (
                <>
                  <br />
                  Package hours will be returned to the customer.
                </>
              )}
            </>
          }
          confirmLabel="Cancel reservation"
          busy={cancelling}
          error={cancelError}
          onConfirm={() => void confirmCancel()}
          onClose={() => !cancelling && setToCancel(null)}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "indigo" | "green";
}) {
  const color =
    tone === "indigo"
      ? "text-indigo-600"
      : tone === "green"
        ? "text-emerald-600"
        : "text-slate-900";
  return (
    <div className="card p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className={`text-3xl font-extrabold mt-1 tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  );
}
