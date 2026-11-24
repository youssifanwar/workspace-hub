"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import ActiveMeetingRooms from "./ActiveMeetingRooms";
import ConfirmDialog from "./ConfirmDialog";
import ReservationDialog from "./ReservationDialog";
import StartNowDialog from "./StartNowDialog";
import { useFmt } from "@/lib/lang-context";
import { PageBar, Panel, StatStrip } from "../_components/ui";

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

  const free = Math.max(0, rooms.length - inUse);
  return (
    <div className="meeting-room-workspace">
      <PageBar
        crumb={tx("ROOM CONTROL")}
        title={tx("Meeting rooms")}
        description={tx("One clear view of room availability, customer check-ins and the schedule ahead.")}
        actions={
          <>
            <Link href="/meeting-rooms/calendar" className="btn btn-ghost">{tx("Calendar")}</Link>
            <button type="button" className="btn btn-ghost" disabled={rooms.length === 0} onClick={() => setStartNow({ roomId: null })}>⚡ {tx("Walk-in")}</button>
            <button type="button" className="btn btn-primary" disabled={rooms.length === 0} onClick={() => setBooking({ roomId: null, start: nextSlotStart() })}>＋ {tx("New reservation")}</button>
          </>
        }
      />

      {notice && (
        <div role={notice.kind === "error" ? "alert" : "status"} className={`v2-alert ${notice.kind === "error" ? "red" : "green"}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <span>{notice.text}</span>
          <button type="button" aria-label={tx("Dismiss")} className="opacity-60 hover:opacity-100" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}

      <StatStrip
        items={[
          { label: tx("Rooms"), value: String(rooms.length), tone: "brand" },
          { label: tx("In use now"), value: String(inUse), tone: "amber" },
          { label: tx("Available now"), value: String(free), tone: "green" },
          { label: tx("Upcoming today"), value: String(todayCount), tone: "slate" },
        ]}
      />

      <h2 className="v2-h2">{tx("Your rooms")} <span className="v2-tag slate">{rooms.length}</span></h2>
      {rooms.length === 0 ? (
        <div className="v2-empty">{tx("No meeting rooms yet. Add one in Settings → Desks.")}</div>
      ) : (
        <div className="v2-rooms">
          {roomState.map(({ room, current, next, fromRate }) => {
            const busy = current?.status === "active";
            return (
              <article key={room.id} className={`v2-room ${busy ? "busy" : "free"}`}>
                <div className="v2-room-head">
                  <div style={{ minWidth: 0 }}>
                    <h3>{room.name}</h3>
                    <small>
                      {f.en ? `Up to ${room.capacity} people` : `لحد ${room.capacity} أفراد`}
                      {fromRate !== null ? ` · ${tx("from")} ${fromRate.toFixed(0)} ${f.cur}/${tx("h")}` : ""}
                    </small>
                  </div>
                  <span className={`v2-tag ${busy ? "amber" : "green"}`}>{busy ? tx("In use") : tx("Available")}</span>
                </div>
                <div className="v2-room-body">
                  {current ? (
                    <>
                      <b>{current.customerName}</b>
                      <span>{f.en ? `Until ${fmtTime(current.endAt)}` : `لحد ${fmtTime(current.endAt)}`}</span>
                    </>
                  ) : next ? (
                    <>
                      <span>{tx("Next reservation")}</span>
                      <b>{fmtTime(next.startAt)} · {next.customerName}</b>
                    </>
                  ) : (
                    <span>{tx("Nothing scheduled")}</span>
                  )}
                </div>
                <div className="v2-room-actions">
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setStartNow({ roomId: room.id })}>{tx("⚡ Start now")}</button>
                  <button type="button" className="btn btn-primary" onClick={() => setBooking({ roomId: room.id, start: nextSlotStart() })}>{tx("Reserve")}</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ActiveMeetingRooms currency={currency} categories={menuCategories} products={menuProducts} />

      <h2 className="v2-h2">{tx("Upcoming reservations")} <span className="v2-tag slate">{upcoming.length}</span></h2>
      {grouped.length === 0 ? (
        <div className="v2-empty">{tx("No upcoming reservations.")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {grouped.map(([key, items]) => (
            <Panel key={key} title={dayLabel(key, items[0].startAt)} flush>
              <div className="v2-list">
                {items.map((r) => {
                  const startMs = new Date(r.startAt).getTime();
                  const opensAt = startMs - earlyCheckinMinutes * 60_000;
                  const canCheckIn = now >= opensAt;
                  return (
                    <div key={r.id} className="v2-list-row" style={{ flexWrap: "wrap", gap: 12 }}>
                      <div style={{ width: 96 }}>
                        <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmtTime(r.startAt)}</b>
                        <small>{f.en ? `to ${fmtTime(r.endAt)}` : `إلى ${fmtTime(r.endAt)}`}</small>
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <b>{r.customerName}</b>
                        <small>
                          {r.roomName} · {f.en ? `${r.attendeeCount} ${r.attendeeCount === 1 ? "person" : "people"}` : `${r.attendeeCount} أفراد`}
                          {r.customerPhone ? ` · ${r.customerPhone}` : ""}
                        </small>
                      </div>
                      {r.usesPackage && <span className="v2-tag blue">{tx("Package")}</span>}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={!canCheckIn || checkingIn !== null}
                          title={canCheckIn ? undefined : `${tx("Check-in opens at")} ${fmtTime(opensAt)}`}
                          onClick={() => void checkIn(r)}
                        >
                          {checkingIn === r.id ? tx("Checking in…") : tx("Check in")}
                        </button>
                        <button type="button" className="btn btn-ghost text-rose-600" onClick={() => { setCancelError(null); setToCancel(r); }}>{tx("Cancel")}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          ))}
        </div>
      )}

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
