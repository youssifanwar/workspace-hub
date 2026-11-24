"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import ActiveMeetingRooms from "./ActiveMeetingRooms";
import ConfirmDialog from "./ConfirmDialog";
import ReservationDialog from "./ReservationDialog";
import StartNowDialog from "./StartNowDialog";
import { useFmt } from "@/lib/lang-context";

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

export type MeetingMenuCategory = {
  id: number;
  name: string;
  icon: string;
};

export type MeetingMenuProduct = {
  id: number;
  categoryId: number;
  name: string;
  price: string;
  imageUrl: string | null;
  icon: string;
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
  menuCategories,
  menuProducts,
  timeZone,
  earlyCheckinMinutes,
  maxBookingHours,
}: {
  rooms: HubRoom[];
  reservations: HubReservation[];
  currency: string;
  menuCategories: MeetingMenuCategory[];
  menuProducts: MeetingMenuProduct[];
  timeZone: string;
  earlyCheckinMinutes: number;
  maxBookingHours: number;
}) {
  const f = useFmt();
  const tx = f.t;
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
      ? tx("Today")
      : key === tomorrowKey
        ? tx("Tomorrow")
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
          text: data?.error || (f.en ? `Could not check in (HTTP ${res.status}).` : `مقدرناش نسجل الدخول (HTTP ${res.status}).`),
        });
        return;
      }
      setNotice({
        kind: "success",
        text: (f.en ? `${r.customerName} is checked in to ${r.roomName}.` : `${r.customerName} دخل ${r.roomName}.`),
      });
      router.refresh();
    } catch {
      setNotice({ kind: "error", text: tx("Network error. Please try again.") });
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
          data?.error || (f.en ? `Could not cancel the reservation (HTTP ${res.status}).` : `مقدرناش نلغي الحجز (HTTP ${res.status}).`),
        );
        return;
      }
      setNotice({
        kind: "success",
        text: (f.en ? `Reservation for ${toCancel.customerName} was cancelled.${toCancel.usesPackage ? " Package hours were returned." : ""}` : `تم إلغاء حجز ${toCancel.customerName}.${toCancel.usesPackage ? " ساعات الباقة رجعت." : ""}`),
      });
      setToCancel(null);
      router.refresh();
    } catch {
      setCancelError(tx("Network error. Please try again."));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-8 meeting-room-workspace">
      {/* Premium room operations hero */}
      <section className="meeting-rooms-hero" aria-labelledby="meeting-rooms-title">
        <div className="meeting-hero-ambient" aria-hidden="true">
          <span className="meeting-hero-orb meeting-hero-orb-a" />
          <span className="meeting-hero-orb meeting-hero-orb-b" />
          <span className="meeting-hero-grid" />
        </div>
        <div className="meeting-hero-content">
          <div className="meeting-hero-eyebrow">
            <span className="meeting-hero-live-dot" />
            <span>{tx("WORKSPACE HUB")}</span>
            <span className="meeting-hero-separator">/</span>
            <span>{tx("ROOM CONTROL")}</span>
            <span className="meeting-hero-live-pill">{tx("LIVE OPERATIONS")}</span>
          </div>
          <h1 id="meeting-rooms-title">{tx("Meeting rooms")}<span className="meeting-hero-title-stop">.</span></h1>
          <p>{tx("One clear view of room availability, customer check-ins and the schedule ahead.")}</p>
          <div className="meeting-hero-metrics" aria-label={tx("Current room summary")}>
            <span><strong>{rooms.length.toString().padStart(2, "0")}</strong> {tx("rooms")}</span>
            <i aria-hidden="true" />
            <span><strong>{inUse.toString().padStart(2, "0")}</strong> {tx("in use")}</span>
            <i aria-hidden="true" />
            <span><strong>{Math.max(0, rooms.length - inUse).toString().padStart(2, "0")}</strong> {tx("available")}</span>
          </div>
          <div className="meeting-hero-actions">
            <Link href="/meeting-rooms/calendar" className="btn btn-ghost meeting-hero-secondary">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6"/><path d="M7.5 3v4M16.5 3v4M4 9.5h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              {tx("Calendar")}
            </Link>
            <button type="button" className="btn btn-ghost meeting-hero-secondary" disabled={rooms.length === 0} onClick={() => setStartNow({ roomId: null })}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="m13.2 2.8-8 10.1h5.6l-.9 8.3 8-11h-5.5l.8-7.4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
              {tx("Walk-in")}
            </button>
            <button type="button" className="btn btn-primary meeting-hero-primary" disabled={rooms.length === 0} onClick={() => setBooking({ roomId: null, start: nextSlotStart() })}>
              <span aria-hidden="true">＋</span> {tx("New reservation")}
            </button>
          </div>
        </div>
        <div className="meeting-hero-visual" aria-hidden="true">
          <div className="meeting-hero-orbit meeting-hero-orbit-one" />
          <div className="meeting-hero-orbit meeting-hero-orbit-two" />
          <div className="meeting-hero-core">
            <svg viewBox="0 0 64 64" width="44" height="44" fill="none"><path d="M9 28 32 10l23 18v25a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3V28Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/><path d="M20 56V34h24v22M27 34v22M9 28h46" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M22 22h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            <span>{tx("HUB")}</span>
          </div>
          <div className="meeting-hero-float-card meeting-hero-float-a"><span className="meeting-hero-float-icon is-blue">⌂</span><span><small>{tx("ROOMS ONLINE")}</small><strong>{rooms.length.toString().padStart(2, "0")}</strong></span><i /></div>
          <div className="meeting-hero-float-card meeting-hero-float-b"><span className="meeting-hero-float-icon is-green">↗</span><span><small>{tx("AVAILABLE NOW")}</small><strong>{Math.max(0, rooms.length - inUse).toString().padStart(2, "0")}</strong></span><i /></div>
          <div className="meeting-hero-orbit-caption"><span /> {tx("CAPACITY MONITORING")}</div>
        </div>
      </section>

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
            aria-label={tx("Dismiss")}
            className="opacity-60 hover:opacity-100"
            onClick={() => setNotice(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 meeting-room-stat-grid">
        <Stat icon="▦" label={tx("Rooms")} value={rooms.length} tone="blue" />
        <Stat icon="◉" label={tx("In use now")} value={inUse} tone="indigo" />
        <Stat icon="↗" label={tx("Available now")} value={Math.max(0, rooms.length - inUse)} tone="green" />
        <Stat icon="◷" label={tx("Upcoming today")} value={todayCount} tone="cyan" />
      </div>

      {/* Rooms */}
      <section className="meeting-rooms-section">
        <div className="meeting-section-heading">
          <div><span className="meeting-section-kicker">{tx("SPACE AVAILABILITY")}</span><h2 className="text-lg font-bold text-slate-900">{tx("Your rooms")}</h2></div>
          <span className="meeting-section-count">{rooms.length} spaces</span>
        </div>
        {rooms.length === 0 ? (
          <div className="card p-10 text-center text-slate-500">
            {tx("No meeting rooms yet. Add one in Settings → Desks.")}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {roomState.map(({ room, current, next, fromRate }) => {
              const busy = current?.status === "active";
              return (
                <article
                  key={room.id}
                  className={`card meeting-room-card p-5 flex flex-col gap-4 ${busy ? "is-busy" : "is-available"}`}
                >
                  <div className="meeting-room-card-accent" aria-hidden="true" />
                  <div className="flex items-start justify-between gap-3">
                    <div className="meeting-room-title-wrap min-w-0">
                      <span className="meeting-room-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M3 10 12 3l9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M8 21v-7h8v7M12 14v7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg></span>
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-slate-900 truncate">
                          {room.name}
                        </h3>
                        <p className="text-sm text-slate-500">
                          Up to {room.capacity} people
                          {fromRate !== null
                            ? ` · ${tx("from")} ${fromRate.toFixed(0)} ${currency}/${tx("h")}`
                            : ""}
                        </p>
                      </div>
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
                      {busy ? tx("In use") : tx("Available")}
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
                        <div className="text-slate-500">{tx("Next reservation")}</div>
                        <div className="font-semibold text-slate-800">
                          {fmtTime(next.startAt)} · {next.customerName}
                        </div>
                      </>
                    ) : (
                      <div className="text-slate-400">
                        {tx("Nothing scheduled")}
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
                      {tx("⚡ Start now")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() =>
                        setBooking({ roomId: room.id, start: nextSlotStart() })
                      }
                    >
                      {tx("Reserve")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* In the room now */}
      <ActiveMeetingRooms
        currency={currency}
        categories={menuCategories}
        products={menuProducts}
      />

      {/* Upcoming */}
      <section className="meeting-rooms-section meeting-upcoming-section">
        <div className="meeting-section-heading">
          <div><span className="meeting-section-kicker">{tx("SCHEDULE")}</span><h2 className="text-lg font-bold text-slate-900">{tx("Upcoming reservations")}</h2></div>
          <span className="meeting-section-count">{upcoming.length} bookings</span>
        </div>
        {grouped.length === 0 ? (
          <div className="card p-10 text-center text-slate-500">
            {tx("No upcoming reservations.")}
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
                            {tx("Package")}
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
                                : `${tx("Check-in opens at")} ${fmtTime(opensAt)}`
                            }
                            onClick={() => void checkIn(r)}
                          >
                            {checkingIn === r.id ? tx("Checking in…") : tx("Check in")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost text-rose-600"
                            onClick={() => {
                              setCancelError(null);
                              setToCancel(r);
                            }}
                          >
                            {tx("Cancel")}
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
          title={tx("Cancel this reservation?")}
          message={
            <>
              <b>{toCancel.customerName}</b> · {toCancel.roomName}
              <br />
              {fmtTime(toCancel.startAt)} – {fmtTime(toCancel.endAt)}
              {toCancel.usesPackage && (
                <>
                  <br />
                  {tx("Package hours will be returned to the customer.")}
                </>
              )}
            </>
          }
          confirmLabel={tx("Cancel reservation")}
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
  icon,
  label,
  value,
  tone = "blue",
}: {
  icon: string;
  label: string;
  value: number;
  tone?: "blue" | "indigo" | "green" | "cyan";
}) {
  const f = useFmt();
  const tx = f.t;
  return (
    <div className={`card meeting-room-stat tone-${tone}`}>
      <div className="meeting-room-stat-icon" aria-hidden="true">{icon}</div>
      <div className="meeting-room-stat-copy">
        <div className="meeting-room-stat-label">{label}</div>
        <div className="meeting-room-stat-value tabular-nums">{value.toString().padStart(2, "0")}</div>
        <div className="meeting-room-stat-foot"><span /> {tx("LIVE STATUS")}</div>
      </div>
      <span className="meeting-room-stat-orb" aria-hidden="true" />
    </div>
  );
}
