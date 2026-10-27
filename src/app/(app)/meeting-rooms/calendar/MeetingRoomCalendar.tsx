"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  toZonedDateInput,
  zonedWallTimeToDate,
} from "@/lib/zoned-time";

import ConfirmDialog from "../ConfirmDialog";
import ReservationDialog from "../ReservationDialog";

/* ============================================================================
 * TYPES
 * ========================================================================== */

type Room = {
  id: number;
  name: string;
  hourlyRate: string;
  capacity: number;
};

type Reservation = {
  id: number;
  deskId: number;
  roomName: string;
  customerName: string | null;
  customerPhone: string | null;
  startAt: string;
  endAt: string;
  status: string; // confirmed | active | closed
  notes: string | null;
  attendeeCount: number;
  usesPackage: boolean;
};

type ViewMode = "day" | "week" | "month" | "list" | "rooms";
type StatusFilter = "all" | "confirmed" | "active" | "closed";

const HOUR_PX = 60;
const GUTTER_PX = 56;

/* ============================================================================
 * CIVIL-DATE HELPERS
 *
 * The calendar works in the WORKSPACE timezone. A "day" is a plain
 * "YYYY-MM-DD" key; converting a key + time of day to a real instant goes
 * through zonedWallTimeToDate, so the grid is right even if the browser is
 * in a different timezone.
 * ========================================================================== */

const pad = (n: number) => String(n).padStart(2, "0");

function keyToUtc(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function utcToKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate(),
  )}`;
}
function addDays(key: string, n: number): string {
  const d = keyToUtc(key);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToKey(d);
}
function addMonths(key: string, n: number): string {
  const d = keyToUtc(key);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return utcToKey(d);
}
function weekday(key: string): number {
  return keyToUtc(key).getUTCDay();
}
function startOfWeek(key: string, weekStartsOn: number): string {
  return addDays(key, -((weekday(key) - weekStartsOn + 7) % 7));
}
function fmtKey(key: string, opts: Intl.DateTimeFormatOptions): string {
  return keyToUtc(key).toLocaleDateString("en-GB", {
    ...opts,
    timeZone: "UTC",
  });
}

const STATUS_STYLE: Record<
  string,
  { box: string; label: string; dot: string }
> = {
  confirmed: {
    box: "bg-indigo-50 border-indigo-200 border-l-indigo-500 text-indigo-900",
    label: "Reserved",
    dot: "bg-indigo-500",
  },
  active: {
    box: "bg-emerald-50 border-emerald-200 border-l-emerald-500 text-emerald-900",
    label: "In session",
    dot: "bg-emerald-500",
  },
  closed: {
    box: "bg-slate-100 border-slate-200 border-l-slate-400 text-slate-500",
    label: "Completed",
    dot: "bg-slate-400",
  },
};
const styleOf = (status: string) => STATUS_STYLE[status] ?? STATUS_STYLE.closed;

/* ============================================================================
 * COMPONENT
 * ========================================================================== */

export default function MeetingRoomCalendar({
  rooms,
  reservations,
  startHour,
  endHour,
  maxBookingHours,
  currency,
  timeZone,
  weekStartsOn,
  earlyCheckinMinutes,
}: {
  rooms: Room[];
  reservations: Reservation[];
  startHour: number;
  endHour: number;
  maxBookingHours: number;
  currency: string;
  timeZone: string;
  weekStartsOn: number;
  earlyCheckinMinutes: number;
}) {
  const router = useRouter();
  const tz = timeZone;

  const [now, setNow] = useState(() => Date.now());
  const todayKey = toZonedDateInput(new Date(now), tz);

  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(todayKey);
  const [roomFilter, setRoomFilter] = useState<number | "">("");
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [selected, setSelected] = useState<Reservation | null>(null);
  const [booking, setBooking] = useState<Date | null>(null);
  const [toCancel, setToCancel] = useState<Reservation | null>(null);
  const [busy, setBusy] = useState<"checkin" | "cancel" | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // Keep "now" fresh and pull new data so several staff stay in sync.
  const lastRefresh = useRef(Date.now());
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRefresh.current > 60_000
      ) {
        lastRefresh.current = Date.now();
        router.refresh();
      }
    }, 30_000);
    return () => clearInterval(tick);
  }, [router]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const at = (key: string, minutes: number): Date =>
    zonedWallTimeToDate(
      minutes >= 1440 ? addDays(key, 1) : key,
      `${pad(Math.floor((minutes % 1440) / 60))}:${pad(minutes % 60)}`,
      tz,
    ) as Date;

  const fmtTime = (d: Date | string | number) =>
    new Date(d).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    });

  const visible = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase();
    return reservations.filter((r) => {
      if (roomFilter !== "" && r.deskId !== roomFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!query) return true;
      const haystack = [
        r.customerName,
        r.customerPhone,
        r.roomName,
        r.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(query);
    });
  }, [reservations, roomFilter, searchText, statusFilter]);

  const summary = useMemo(() => {
    const today = reservations.filter(
      (r) => toZonedDateInput(new Date(r.startAt), tz) === todayKey,
    );
    const inProgress = reservations.filter((r) => r.status === "active");
    const upcoming = today.filter(
      (r) => r.status === "confirmed" && new Date(r.startAt).getTime() > now,
    );
    const occupied = new Set(
      reservations
        .filter((r) => {
          const start = new Date(r.startAt).getTime();
          const end = new Date(r.endAt).getTime();
          return r.status !== "closed" && start <= now && end > now;
        })
        .map((r) => r.deskId),
    );
    return {
      today: today.length,
      inProgress: inProgress.length,
      upcoming: upcoming.length,
      availableRooms: Math.max(0, rooms.length - occupied.size),
    };
  }, [reservations, rooms, todayKey, tz, now]);

  /* ---------------------------------------------------------------- range */
  const days = useMemo(() => {
    if (view === "day") return [anchor];
    if (view === "list") return Array.from({ length: 14 }, (_, i) => addDays(anchor, i));
    if (view === "rooms") {
      const s = startOfWeek(anchor, weekStartsOn);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    if (view === "week") {
      const s = startOfWeek(anchor, weekStartsOn);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    const first = addMonths(anchor, 0).slice(0, 8) + "01";
    const s = startOfWeek(first, weekStartsOn);
    const nextFirst = addMonths(first, 1);
    const weeks = Math.ceil(
      (keyToUtc(nextFirst).getTime() - keyToUtc(s).getTime()) / 86_400_000 / 7,
    );
    return Array.from({ length: weeks * 7 }, (_, i) => addDays(s, i));
  }, [view, anchor, weekStartsOn]);

  const rangeReservations = useMemo(() => {
    if (!days.length) return [] as Reservation[];
    const from = at(days[0], 0).getTime();
    const until = at(addDays(days[days.length - 1], 1), 0).getTime();
    return visible.filter((r) => {
      const startsAt = new Date(r.startAt).getTime();
      const endsAt = new Date(r.endAt).getTime();
      return startsAt < until && endsAt > from;
    });
    // `at` is a pure workspace-timezone helper tied to the current timezone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, days, tz]);

  const title = useMemo(() => {
    if (view === "day")
      return fmtKey(anchor, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    if (view === "month")
      return fmtKey(anchor, { month: "long", year: "numeric" });
    if (view === "list") {
      return `${fmtKey(days[0], { day: "numeric", month: "short" })} – ${fmtKey(days[days.length - 1], { day: "numeric", month: "short", year: "numeric" })}`;
    }
    const a = days[0];
    const b = days[6];
    const sameMonth = a.slice(0, 7) === b.slice(0, 7);
    return `${fmtKey(a, { day: "numeric", month: sameMonth ? undefined : "short" })} – ${fmtKey(
      b,
      { day: "numeric", month: "short", year: "numeric" },
    )}`;
  }, [view, anchor, days]);

  function move(dir: -1 | 1) {
    if (view === "day") setAnchor((k) => addDays(k, dir));
    else if (view === "week" || view === "rooms") setAnchor((k) => addDays(k, dir * 7));
    else if (view === "list") setAnchor((k) => addDays(k, dir * 14));
    else setAnchor((k) => addMonths(k, dir));
  }

  /* --------------------------------------------------------- time-grid data */
  const gridMinutes = (endHour - startHour) * 60;
  const gridHeight = (gridMinutes / 60) * HOUR_PX;
  const hours = Array.from(
    { length: endHour - startHour },
    (_, i) => startHour + i,
  );

  type Placed = {
    r: Reservation;
    top: number;
    height: number;
    lane: number;
    lanes: number;
  };

  const placedByDay = useMemo(() => {
    const result = new Map<string, Placed[]>();
    let hidden = 0;

    for (const key of days) {
      if (view === "month" || view === "list" || view === "rooms") break;
      const winStart = at(key, startHour * 60).getTime();
      const winEnd = at(key, endHour * 60).getTime();
      const dayStart = at(key, 0).getTime();
      const dayEnd = at(key, 1440).getTime();

      const items = visible
        .map((r) => ({
          r,
          s: new Date(r.startAt).getTime(),
          e: new Date(r.endAt).getTime(),
        }))
        .filter((x) => x.s < dayEnd && x.e > dayStart)
        .sort((a, b) => a.s - b.s || a.e - b.e);

      const placed: Placed[] = [];
      let cluster: Placed[] = [];
      let laneEnds: number[] = [];
      let clusterEnd = -Infinity;

      const flush = () => {
        const lanes = Math.max(1, laneEnds.length);
        for (const p of cluster) p.lanes = lanes;
        placed.push(...cluster);
        cluster = [];
        laneEnds = [];
      };

      for (const x of items) {
        const cs = Math.max(x.s, winStart);
        const ce = Math.min(x.e, winEnd);
        if (ce <= cs) {
          hidden += 1;
          continue;
        }
        if (cs >= clusterEnd && cluster.length) flush();
        let lane = laneEnds.findIndex((end) => end <= cs);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(ce);
        } else {
          laneEnds[lane] = ce;
        }
        clusterEnd = Math.max(clusterEnd === -Infinity ? 0 : clusterEnd, ce);
        cluster.push({
          r: x.r,
          top: ((cs - winStart) / 60000 / 60) * HOUR_PX,
          height: Math.max(((ce - cs) / 60000 / 60) * HOUR_PX, 22),
          lane,
          lanes: 1,
        });
      }
      if (cluster.length) flush();
      result.set(key, placed);
    }
    return { map: result, hidden };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, view, visible, startHour, endHour, tz]);

  const byDayForMonth = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    if (view !== "month") return map;
    for (const r of visible) {
      const key = toZonedDateInput(new Date(r.startAt), tz);
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      );
    }
    return map;
  }, [visible, view, tz]);

  const listReservations = useMemo(() => {
    if (view !== "list" || days.length === 0) return [] as Reservation[];
    const from = at(days[0], 0).getTime();
    const until = at(addDays(days[days.length - 1], 1), 0).getTime();
    return visible
      .filter((r) => {
        const startsAt = new Date(r.startAt).getTime();
        const endsAt = new Date(r.endAt).getTime();
        return startsAt < until && endsAt > from;
      })
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    // `at` is a pure workspace-timezone helper tied to the current timezone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, days, visible, tz]);

  const groupedListReservations = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of listReservations) {
      const key = toZonedDateInput(new Date(r.startAt), tz);
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [listReservations, tz]);

  const reservationsByRoomDay = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of visible) {
      const key = toZonedDateInput(new Date(r.startAt), tz);
      if (!days.includes(key)) continue;
      const index = `${r.deskId}:${key}`;
      map.set(index, [...(map.get(index) ?? []), r]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }
    return map;
  }, [visible, days, tz]);

  function findSuggestedSlot(roomId: number, dayKey: string): Date | null {
    const dayStart = at(dayKey, 0).getTime();
    const currentHour = Math.floor((now - dayStart) / 3_600_000);
    const firstHour = dayKey === todayKey ? Math.max(startHour, currentHour + 1) : startHour;
    for (let hour = firstHour; hour < endHour; hour += 1) {
      const candidate = at(dayKey, hour * 60);
      const candidateEnd = candidate.getTime() + 60 * 60_000;
      if (candidate.getTime() <= now) continue;
      const conflict = reservations.some((r) => {
        if (r.deskId !== roomId || r.status === "closed") return false;
        const existingStart = new Date(r.startAt).getTime();
        const existingEnd = new Date(r.endAt).getTime();
        return candidate.getTime() < existingEnd && candidateEnd > existingStart;
      });
      if (!conflict) return candidate;
    }
    return null;
  }

  /* ---------------------------------------------------------------- actions */
  function defaultBookingStart(): Date {
    const todayStart = at(todayKey, 0).getTime();
    const nextWholeHour = Math.floor((now - todayStart) / 3_600_000) + 1;
    const hour = Math.max(startHour, nextWholeHour);
    if (hour < endHour) return at(todayKey, hour * 60);
    return at(addDays(todayKey, 1), startHour * 60);
  }

  function openBooking(start: Date) {
    if (start.getTime() <= Date.now()) return;
    setBooking(start);
  }

  async function checkIn(r: Reservation) {
    if (busy) return;
    setBusy("checkin");
    setDialogError(null);
    try {
      const res = await fetch(`/api/meeting-rooms/reservations/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_in" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDialogError(
          data?.error || `Could not check in (HTTP ${res.status}).`,
        );
        return;
      }
      setSelected(null);
      setNotice({
        kind: "success",
        text: `${r.customerName ?? "Customer"} is checked in to ${r.roomName}.`,
      });
      router.refresh();
    } catch {
      setDialogError("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmCancel() {
    if (!toCancel || busy) return;
    setBusy("cancel");
    setDialogError(null);
    try {
      const res = await fetch(
        `/api/meeting-rooms/reservations/${toCancel.id}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDialogError(
          data?.error || `Could not cancel (HTTP ${res.status}).`,
        );
        return;
      }
      setNotice({
        kind: "success",
        text: `Reservation for ${toCancel.customerName ?? "customer"} was cancelled.`,
      });
      setToCancel(null);
      setSelected(null);
      router.refresh();
    } catch {
      setDialogError("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  /* ------------------------------------------------------------------ view */
  return (
    <div className="space-y-5">
      {/* Premium scheduling command center */}
      <section className="calendar-command-center">
        <div className="calendar-command-orb calendar-command-orb-one" />
        <div className="calendar-command-orb calendar-command-orb-two" />
        <div className="calendar-command-grid" />
        <div className="calendar-command-copy">
          <div className="calendar-command-eyebrow"><span className="calendar-live-dot" /> WORKSPACE HUB <span className="calendar-eyebrow-divider">/</span> MEETING ROOM OPERATIONS</div>
          <h1>Every room. Every booking. <span>Under control.</span></h1>
          <p>A live command center for your meeting rooms — see who booked, spot gaps, and manage reservations without digging through the calendar.</p>
          <div className="calendar-command-trust-row">
            <span><b>{rooms.length}</b> rooms tracked</span><i />
            <span><b>{summary.today}</b> bookings today</span><i />
            <span><b>{summary.inProgress}</b> live sessions</span>
          </div>
        </div>
        <div className="calendar-command-side">
          <div className="calendar-command-orbit calendar-command-orbit-a" />
          <div className="calendar-command-orbit calendar-command-orbit-b" />
          <div className="calendar-command-core"><span className="calendar-command-core-icon">▦</span><strong>ROOMS</strong><small>LIVE SCHEDULE</small></div>
          <div className="calendar-float-badge calendar-float-badge-a"><span className="calendar-badge-icon">↗</span><span><small>UPCOMING</small><strong>{summary.upcoming}</strong></span><i /></div>
          <div className="calendar-float-badge calendar-float-badge-b"><span className="calendar-badge-icon is-teal">◉</span><span><small>AVAILABLE</small><strong>{summary.availableRooms}</strong></span><i /></div>
        </div>
        <button
          type="button"
          className="btn calendar-command-create"
          disabled={rooms.length === 0}
          onClick={() => setBooking(defaultBookingStart())}
        >
          <span aria-hidden="true">＋</span> Create reservation
        </button>
      </section>

      <section className="calendar-overview-grid" aria-label="Booking overview">
        <article className="calendar-overview-card tone-blue">
          <span className="calendar-overview-icon" aria-hidden="true">▦</span>
          <div><p>Bookings today</p><strong>{summary.today}</strong><small>Reservations starting today</small></div>
        </article>
        <article className="calendar-overview-card tone-teal">
          <span className="calendar-overview-icon" aria-hidden="true">◉</span>
          <div><p>Rooms available now</p><strong>{summary.availableRooms}<em> / {rooms.length}</em></strong><small>Based on scheduled time slots</small></div>
        </article>
        <article className="calendar-overview-card tone-violet">
          <span className="calendar-overview-icon" aria-hidden="true">◷</span>
          <div><p>Upcoming today</p><strong>{summary.upcoming}</strong><small>Confirmed reservations ahead</small></div>
        </article>
        <article className="calendar-overview-card tone-green">
          <span className="calendar-overview-icon" aria-hidden="true">↗</span>
          <div><p>Sessions in progress</p><strong>{summary.inProgress}</strong><small>Currently checked in</small></div>
        </article>
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
            aria-label="Dismiss"
            className="opacity-60 hover:opacity-100"
            onClick={() => setNotice(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Search, filters and view switching */}
      <section className="calendar-control-panel">
        <div className="calendar-control-topline">
          <div className="calendar-date-navigation">
            <div className="calendar-nav-buttons">
              <button type="button" className="calendar-nav-button" onClick={() => move(-1)} aria-label="Previous date range">‹</button>
              <button type="button" className="calendar-nav-button" onClick={() => move(1)} aria-label="Next date range">›</button>
            </div>
            <button type="button" className="calendar-today-button" onClick={() => setAnchor(todayKey)}>Today</button>
            <div className="calendar-current-range">
              <span className="calendar-range-kicker">SCHEDULE WINDOW</span>
              <h2>{title}</h2>
            </div>
          </div>
          <div className="calendar-view-switch" role="tablist" aria-label="Calendar view">
            {(["day", "week", "rooms", "month", "list"] as ViewMode[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={view === v ? "is-active" : ""}
              >
                {v === "list" ? "Agenda" : v === "rooms" ? "Room grid" : v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="calendar-filter-row">
          <label className="calendar-search-box">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search customer, phone, room, notes…"
              aria-label="Search reservations"
            />
            {searchText && <button type="button" onClick={() => setSearchText("")} aria-label="Clear search">×</button>}
          </label>
          <label className="calendar-filter-select">
            <span>Room</span>
            <select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value ? Number(e.target.value) : "")} aria-label="Filter by room">
              <option value="">All rooms</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="calendar-filter-select">
            <span>Status</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} aria-label="Filter by reservation status">
              <option value="all">All statuses</option>
              <option value="confirmed">Reserved</option>
              <option value="active">In session</option>
              <option value="closed">Completed</option>
            </select>
          </label>
          {(searchText || roomFilter !== "" || statusFilter !== "all") && (
            <button type="button" className="calendar-clear-filters" onClick={() => { setSearchText(""); setRoomFilter(""); setStatusFilter("all"); }}>Clear filters</button>
          )}
        </div>
        <div className="calendar-control-footer">
          <div className="calendar-status-legend">
            {Object.entries(STATUS_STYLE).map(([k, v]) => (
              <span key={k}><i className={v.dot} />{v.label}</span>
            ))}
          </div>
          <span className="calendar-results-count"><strong>{rangeReservations.length}</strong> matching bookings</span>
        </div>
      </section>

      {/* Calendar / agenda */}
      {view === "list" ? (
        <section className="calendar-agenda-panel" aria-label="Reservation agenda">
          <div className="calendar-agenda-heading">
            <div><span className="calendar-range-kicker">RESERVATION FEED</span><h2>Bookings at a glance</h2><p>Open any booking for details, check-in, or cancellation.</p></div>
            <span className="calendar-agenda-total">{listReservations.length} bookings</span>
          </div>
          {groupedListReservations.length === 0 ? (
            <div className="calendar-empty-state">
              <span className="calendar-empty-icon">⌁</span>
              <h3>No bookings match this view</h3>
              <p>Try a different date range or clear one of the filters.</p>
              <button type="button" className="btn btn-primary" onClick={() => { setSearchText(""); setRoomFilter(""); setStatusFilter("all"); }}>Clear filters</button>
            </div>
          ) : (
            <div className="calendar-agenda-days">
              {groupedListReservations.map(([dayKey, items]) => (
                <section className="calendar-agenda-day" key={dayKey}>
                  <header className={dayKey === todayKey ? "is-today" : ""}>
                    <div className="calendar-agenda-date"><strong>{Number(dayKey.slice(8))}</strong><span>{fmtKey(dayKey, { month: "short" })}</span></div>
                    <div className="calendar-agenda-day-title"><h3>{dayKey === todayKey ? "Today" : fmtKey(dayKey, { weekday: "long" })}</h3><p>{fmtKey(dayKey, { month: "long", day: "numeric", year: "numeric" })}</p></div>
                    <span className="calendar-agenda-day-count">{items.length} {items.length === 1 ? "booking" : "bookings"}</span>
                  </header>
                  <div className="calendar-agenda-items">
                    {items.map((r) => {
                      const st = styleOf(r.status);
                      const durationMinutes = Math.max(0, Math.round((new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 60000));
                      return (
                        <button type="button" key={r.id} className="calendar-agenda-row" onClick={() => { setDialogError(null); setSelected(r); }}>
                          <div className="calendar-agenda-time"><strong>{fmtTime(r.startAt)}</strong><span>{fmtTime(r.endAt)}</span><small>{durationMinutes >= 60 ? `${Math.floor(durationMinutes / 60)}h${durationMinutes % 60 ? ` ${durationMinutes % 60}m` : ""}` : `${durationMinutes}m`}</small></div>
                          <div className={`calendar-agenda-status ${st.dot}`} aria-hidden="true" />
                          <div className="calendar-agenda-main"><div className="calendar-agenda-person">{r.customerName ?? "Customer"}</div><div className="calendar-agenda-subline"><span>{r.roomName}</span>{r.customerPhone && <span>{r.customerPhone}</span>}<span>{r.attendeeCount} {r.attendeeCount === 1 ? "person" : "people"}</span>{r.usesPackage && <span className="calendar-package-tag">Package</span>}</div>{r.notes && <p className="calendar-agenda-notes">{r.notes}</p>}</div>
                          <div className="calendar-agenda-row-end"><span className={`calendar-status-pill status-${r.status}`}>{st.label}</span><span className="calendar-agenda-open">View booking <b>↗</b></span></div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
      ) : view === "rooms" ? (
        <section className="calendar-room-grid-panel">
          <div className="calendar-agenda-heading">
            <div><span className="calendar-range-kicker">SPACE-BY-DATE OVERVIEW</span><h2>Room availability grid</h2><p>Each row is a room. Each column is a day. Bookings are visible at a glance.</p></div>
            <span className="calendar-agenda-total">{rooms.filter((room) => roomFilter === "" || room.id === roomFilter).length} rooms · 7 days</span>
          </div>
          <div className="calendar-room-grid-scroll">
            <div className="calendar-room-grid" style={{ gridTemplateColumns: `minmax(184px, 220px) repeat(${days.length}, minmax(128px, 1fr))` }}>
              <div className="calendar-room-grid-corner"><span>ROOM / DAY</span><strong>Meeting spaces</strong></div>
              {days.map((key) => (
                <div key={key} className={`calendar-room-grid-day ${key === todayKey ? "is-today" : ""}`}>
                  <span>{fmtKey(key, { weekday: "short" })}</span>
                  <strong>{Number(key.slice(8))}</strong>
                  <small>{fmtKey(key, { month: "short" })}</small>
                </div>
              ))}
              {rooms.filter((room) => roomFilter === "" || room.id === roomFilter).map((room) => (
                <FragmentRoomRow
                  key={room.id}
                  room={room}
                  days={days}
                  todayKey={todayKey}
                  timeZone={tz}
                  reservationsByRoomDay={reservationsByRoomDay}
                  findSuggestedSlot={findSuggestedSlot}
                  onOpenReservation={(start) => { setRoomFilter(room.id); openBooking(start); }}
                  onOpenDetails={(reservation) => { setDialogError(null); setSelected(reservation); }}
                />
              ))}
            </div>
          </div>
          <div className="calendar-room-grid-footnote"><span className="calendar-grid-available-key" /> Open cells show the next one-hour slot available within your configured operating hours. The booking form checks availability again before saving.</div>
        </section>
      ) : view === "month" ? (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
            {days.slice(0, 7).map((k) => (
              <div
                key={k}
                className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500"
              >
                {fmtKey(k, { weekday: "short" })}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((k) => {
              const items = byDayForMonth.get(k) ?? [];
              const inMonth = k.slice(0, 7) === anchor.slice(0, 7);
              const isToday = k === todayKey;
              return (
                <div
                  key={k}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setAnchor(k);
                    setView("day");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setAnchor(k);
                      setView("day");
                    }
                  }}
                  className={`min-h-[116px] border-b border-r border-slate-100 p-2 text-left cursor-pointer hover:bg-indigo-50/40 transition ${
                    inMonth ? "bg-white" : "bg-slate-50/70"
                  }`}
                >
                  <div
                    className={`inline-grid place-items-center w-7 h-7 rounded-full text-sm font-semibold ${
                      isToday
                        ? "bg-indigo-600 text-white"
                        : inMonth
                          ? "text-slate-800"
                          : "text-slate-400"
                    }`}
                  >
                    {Number(k.slice(8))}
                  </div>
                  <div className="mt-1 space-y-1">
                    {items.slice(0, 3).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDialogError(null);
                          setSelected(r);
                        }}
                        className={`w-full truncate rounded-md border border-l-4 px-1.5 py-0.5 text-left text-[11px] font-medium ${styleOf(r.status).box}`}
                      >
                        {fmtTime(r.startAt)} {r.customerName ?? "Customer"}
                      </button>
                    ))}
                    {items.length > 3 && (
                      <div className="text-[11px] font-semibold text-slate-500 px-1">
                        +{items.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <div style={{ minWidth: view === "week" ? 860 : 420 }}>
              {/* day headers */}
              <div
                className="grid border-b border-slate-100 bg-slate-50"
                style={{
                  gridTemplateColumns: `${GUTTER_PX}px repeat(${days.length}, minmax(0, 1fr))`,
                }}
              >
                <div />
                {days.map((k) => (
                  <div
                    key={k}
                    className="py-2.5 text-center border-l border-slate-100"
                  >
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      {fmtKey(k, { weekday: "short" })}
                    </div>
                    <div
                      className={`mx-auto mt-0.5 inline-grid place-items-center w-8 h-8 rounded-full text-base font-bold ${
                        k === todayKey
                          ? "bg-indigo-600 text-white"
                          : "text-slate-800"
                      }`}
                    >
                      {Number(k.slice(8))}
                    </div>
                  </div>
                ))}
              </div>

              {/* body */}
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `${GUTTER_PX}px repeat(${days.length}, minmax(0, 1fr))`,
                }}
              >
                {/* time gutter */}
                <div className="relative" style={{ height: gridHeight }}>
                  {hours.map((h, i) => (
                    <div
                      key={h}
                      className="absolute right-2 -translate-y-1/2 text-[11px] font-medium text-slate-400 tabular-nums"
                      style={{ top: i * HOUR_PX }}
                    >
                      {i === 0 ? "" : `${pad(h)}:00`}
                    </div>
                  ))}
                </div>

                {days.map((k) => {
                  const dayStart = at(k, 0).getTime();
                  const dayEnd = at(k, 1440).getTime();
                  const winStart = at(k, startHour * 60).getTime();
                  const pastPx =
                    now >= dayEnd
                      ? gridHeight
                      : now <= dayStart
                        ? 0
                        : Math.min(
                            gridHeight,
                            Math.max(
                              0,
                              ((now - winStart) / 3_600_000) * HOUR_PX,
                            ),
                          );
                  const placed = placedByDay.map.get(k) ?? [];
                  const showNow = now >= dayStart && now < dayEnd;

                  return (
                    <div
                      key={k}
                      className="relative border-l border-slate-100"
                      style={{ height: gridHeight }}
                    >
                      {/* clickable hour rows */}
                      {hours.map((h, i) => {
                        const slotStart = at(k, h * 60);
                        const future = slotStart.getTime() > now;
                        return (
                          <div
                            key={h}
                            role={future ? "button" : undefined}
                            tabIndex={future ? 0 : -1}
                            aria-label={
                              future
                                ? `Reserve ${fmtKey(k, { weekday: "long", day: "numeric", month: "long" })} at ${pad(h)}:00`
                                : undefined
                            }
                            onClick={() => future && openBooking(slotStart)}
                            onKeyDown={(e) => {
                              if (
                                future &&
                                (e.key === "Enter" || e.key === " ")
                              ) {
                                e.preventDefault();
                                openBooking(slotStart);
                              }
                            }}
                            className={`absolute inset-x-0 border-t border-slate-100 ${
                              future
                                ? "cursor-pointer hover:bg-indigo-50/70"
                                : ""
                            }`}
                            style={{ top: i * HOUR_PX, height: HOUR_PX }}
                          />
                        );
                      })}

                      {/* past shading */}
                      {pastPx > 0 && (
                        <div
                          className="absolute inset-x-0 top-0 bg-slate-100/60 pointer-events-none"
                          style={{ height: pastPx }}
                        />
                      )}

                      {/* now line */}
                      {showNow &&
                        now >= winStart &&
                        now <= at(k, endHour * 60).getTime() && (
                          <div
                            className="absolute inset-x-0 z-20 pointer-events-none"
                            style={{
                              top: ((now - winStart) / 3_600_000) * HOUR_PX,
                            }}
                          >
                            <div className="h-0.5 bg-rose-500" />
                            <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-rose-500" />
                          </div>
                        )}

                      {/* events */}
                      <div className="absolute inset-0 pointer-events-none z-10 px-0.5">
                        {placed.map((p) => {
                          const st = styleOf(p.r.status);
                          const width = 100 / p.lanes;
                          return (
                            <button
                              key={p.r.id}
                              type="button"
                              onClick={() => {
                                setDialogError(null);
                                setSelected(p.r);
                              }}
                              className={`absolute pointer-events-auto overflow-hidden rounded-lg border border-l-4 px-2 py-1 text-left shadow-sm transition hover:shadow-md hover:z-30 ${st.box}`}
                              style={{
                                top: p.top + 1,
                                height: p.height - 2,
                                left: `calc(${p.lane * width}% + 2px)`,
                                width: `calc(${width}% - 4px)`,
                              }}
                              title={`${p.r.customerName ?? "Customer"} · ${p.r.roomName}`}
                            >
                              <div className="text-xs font-bold truncate">
                                {p.r.customerName ?? "Customer"}
                              </div>
                              {p.height >= 38 && (
                                <div className="text-[11px] opacity-80 truncate tabular-nums">
                                  {fmtTime(p.r.startAt)}–{fmtTime(p.r.endAt)}
                                  {roomFilter === "" ? ` · ${p.r.roomName}` : ""}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {placedByDay.hidden > 0 && (
            <div className="border-t border-slate-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">
              {placedByDay.hidden} reservation
              {placedByDay.hidden === 1 ? " is" : "s are"} outside the visible
              hours ({pad(startHour)}:00–{pad(endHour % 24)}:00). Change the
              hours in Settings.
            </div>
          )}
        </div>
      )}

      {/* Details */}
      {selected && !toCancel && (
        <Details
          r={selected}
          tz={tz}
          now={now}
          earlyCheckinMinutes={earlyCheckinMinutes}
          busy={busy}
          error={dialogError}
          onClose={() => setSelected(null)}
          onCheckIn={() => void checkIn(selected)}
          onCancel={() => {
            setDialogError(null);
            setToCancel(selected);
          }}
        />
      )}

      {toCancel && (
        <ConfirmDialog
          title={
            toCancel.status === "active"
              ? "Cancel this session?"
              : "Cancel this reservation?"
          }
          message={
            <>
              <b>{toCancel.customerName ?? "Customer"}</b> · {toCancel.roomName}
              <br />
              {fmtTime(toCancel.startAt)} – {fmtTime(toCancel.endAt)}
              <br />
              {toCancel.status === "active"
                ? "The room is freed immediately and nothing is charged."
                : "The time slot becomes free again."}
              {toCancel.usesPackage && " Package hours are returned."}
            </>
          }
          confirmLabel={
            toCancel.status === "active" ? "Cancel session" : "Cancel reservation"
          }
          busy={busy === "cancel"}
          error={dialogError}
          onConfirm={() => void confirmCancel()}
          onClose={() => busy !== "cancel" && setToCancel(null)}
        />
      )}

      {booking && (
        <ReservationDialog
          rooms={rooms.map((r) => ({
            id: r.id,
            name: r.name,
            capacity: r.capacity,
          }))}
          currency={currency}
          initialRoomId={roomFilter === "" ? null : roomFilter}
          initialStart={booking}
          maxDurationHours={maxBookingHours}
          timeZone={tz}
          onClose={() => setBooking(null)}
        />
      )}
    </div>
  );
}

function FragmentRoomRow({
  room,
  days,
  todayKey,
  timeZone,
  reservationsByRoomDay,
  findSuggestedSlot,
  onOpenReservation,
  onOpenDetails,
}: {
  room: Room;
  days: string[];
  todayKey: string;
  timeZone: string;
  reservationsByRoomDay: Map<string, Reservation[]>;
  findSuggestedSlot: (roomId: number, dayKey: string) => Date | null;
  onOpenReservation: (start: Date) => void;
  onOpenDetails: (reservation: Reservation) => void;
}) {
  const formatTime = (value: string) => new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone,
  });
  return (
    <>
      <div className="calendar-room-grid-room">
        <span className="calendar-room-grid-room-icon">▦</span>
        <div><strong>{room.name}</strong><small>Up to {room.capacity} people</small></div>
      </div>
      {days.map((dayKey) => {
        const items = reservationsByRoomDay.get(`${room.id}:${dayKey}`) ?? [];
        const suggested = findSuggestedSlot(room.id, dayKey);
        return (
          <div key={`${room.id}:${dayKey}`} className={`calendar-room-grid-cell ${dayKey === todayKey ? "is-today" : ""}`}>
            {items.length > 0 ? (
              <div className="calendar-room-grid-bookings">
                {items.map((r) => (
                  <button type="button" key={r.id} className={`calendar-room-grid-booking status-${r.status}`} onClick={() => onOpenDetails(r)} title={`${r.customerName ?? "Customer"} · ${r.roomName} · ${formatTime(r.startAt)}–${formatTime(r.endAt)}`}>
                    <span className="calendar-room-grid-booking-time">{formatTime(r.startAt)}–{formatTime(r.endAt)}</span>
                    <strong>{r.customerName ?? "Customer"}</strong>
                    <span className="calendar-room-grid-booking-status">{styleOf(r.status).label}{r.usesPackage ? " · Package" : ""}</span>
                  </button>
                ))}
                {suggested && <button type="button" className="calendar-room-grid-add" onClick={() => onOpenReservation(suggested)}>＋ {formatTime(suggested.toISOString())} available</button>}
              </div>
            ) : suggested ? (
              <button type="button" className="calendar-room-grid-empty" onClick={() => onOpenReservation(suggested)}>
                <span>＋</span><strong>Available</strong><small>Next slot {formatTime(suggested.toISOString())}</small>
              </button>
            ) : (
              <div className="calendar-room-grid-unavailable"><span>—</span><small>No free hour</small></div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ============================================================================
 * DETAILS DIALOG
 * ========================================================================== */

function Details({
  r,
  tz,
  now,
  earlyCheckinMinutes,
  busy,
  error,
  onClose,
  onCheckIn,
  onCancel,
}: {
  r: Reservation;
  tz: string;
  now: number;
  earlyCheckinMinutes: number;
  busy: "checkin" | "cancel" | null;
  error: string | null;
  onClose: () => void;
  onCheckIn: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const st = styleOf(r.status);
  const start = new Date(r.startAt);
  const end = new Date(r.endAt);
  const opensAt = start.getTime() - earlyCheckinMinutes * 60_000;
  const canCheckIn = r.status === "confirmed" && now >= opensAt;
  const canCancel = r.status === "confirmed" || r.status === "active";

  const date = start.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: tz,
  });
  const time = (d: Date) =>
    d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    });

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reservation-details-title"
    >
      <div className="card w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="reservation-details-title"
              className="text-lg font-bold text-slate-900 truncate"
            >
              {r.customerName ?? "Customer"}
            </h2>
            <span
              className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${st.box}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
              {st.label}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="btn btn-ghost !px-3"
            onClick={onClose}
            disabled={!!busy}
          >
            ✕
          </button>
        </div>

        <dl className="px-6 py-5 space-y-3 text-sm">
          <Row k="Room" v={r.roomName} />
          <Row k="Date" v={date} />
          <Row k="Time" v={`${time(start)} – ${time(end)}`} />
          <Row
            k="People"
            v={`${r.attendeeCount} ${r.attendeeCount === 1 ? "person" : "people"}`}
          />
          {r.customerPhone && <Row k="Phone" v={r.customerPhone} />}
          {r.usesPackage && <Row k="Payment" v="Package hours" />}
          {r.notes && <Row k="Notes" v={r.notes} />}
        </dl>

        {error && (
          <div
            role="alert"
            className="mx-6 mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            {error}
          </div>
        )}

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex flex-wrap justify-end gap-2">
          {canCancel && (
            <button
              type="button"
              className="btn btn-ghost text-rose-600 mr-auto"
              disabled={!!busy}
              onClick={onCancel}
            >
              {r.status === "active" ? "Cancel session" : "Cancel reservation"}
            </button>
          )}
          {r.status === "confirmed" && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canCheckIn || !!busy}
              title={
                canCheckIn
                  ? undefined
                  : `Check-in opens at ${time(new Date(opensAt))}`
              }
              onClick={onCheckIn}
            >
              {busy === "checkin"
                ? "Checking in…"
                : canCheckIn
                  ? "Check in"
                  : `Check-in at ${time(new Date(opensAt))}`}
            </button>
          )}
          {r.status === "active" && (
            <span className="text-xs text-slate-500 self-center">
              Check out from Meeting Rooms → In session.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-4">
      <dt className="w-20 shrink-0 text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-900 break-words min-w-0">{v}</dd>
    </div>
  );
}
