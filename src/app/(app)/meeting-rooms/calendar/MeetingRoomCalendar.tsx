"use client";

import { useMemo, useState } from "react";

type Room = {
  id: number;
  name: string;
  hourlyRate: string;
};

type Reservation = {
  id: number;
  deskId: number;
  roomName: string;
  customerName: string | null;
  customerPhone: string | null;
  startAt: string;
  endAt: string;
  status: string;
  notes: string | null;
};

type ViewMode = "day" | "week" | "month";

export default function MeetingRoomCalendar({
  rooms,
  reservations,
}: {
  rooms: Room[];
  reservations: Reservation[];
}) {
  const [view, setView] =
    useState<ViewMode>("week");

  const [selectedRoom, setSelectedRoom] =
    useState<number | null>(null);

  const [currentDate, setCurrentDate] =
    useState(() => new Date());

  const filteredReservations =
    useMemo(() => {
      if (selectedRoom === null) {
        return reservations;
      }

      return reservations.filter(
        (r) => r.deskId === selectedRoom,
      );
    }, [reservations, selectedRoom]);

  const visibleDays = useMemo(
    () =>
      getVisibleDays(
        currentDate,
        view,
      ),
    [currentDate, view],
  );

  function movePrevious() {
    const next = new Date(currentDate);

    if (view === "day") {
      next.setDate(
        next.getDate() - 1,
      );
    } else if (view === "week") {
      next.setDate(
        next.getDate() - 7,
      );
    } else {
      next.setMonth(
        next.getMonth() - 1,
      );
    }

    setCurrentDate(next);
  }

  function moveNext() {
    const next = new Date(currentDate);

    if (view === "day") {
      next.setDate(
        next.getDate() + 1,
      );
    } else if (view === "week") {
      next.setDate(
        next.getDate() + 7,
      );
    } else {
      next.setMonth(
        next.getMonth() + 1,
      );
    }

    setCurrentDate(next);
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  const title = getCalendarTitle(
    currentDate,
    view,
  );

  return (
    <div className="space-y-5">

      {/* HEADER */}
      <div className="card p-5">

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">

          <div>
            <div className="text-xs uppercase text-indigo-600 font-semibold">
              Meeting Rooms
            </div>

            <h1 className="text-2xl font-bold text-slate-900">
              Reservation Calendar
            </h1>

            <p className="text-sm text-slate-500 mt-1">
              All meeting-room reservations are managed inside WorkSpace Hub.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">

            <button
              type="button"
              onClick={goToday}
              className="btn btn-ghost"
            >
              Today
            </button>

            <button
              type="button"
              onClick={movePrevious}
              className="w-10 h-10 rounded-xl border border-slate-200 hover:bg-slate-50 font-bold"
            >
              ←
            </button>

            <button
              type="button"
              onClick={moveNext}
              className="w-10 h-10 rounded-xl border border-slate-200 hover:bg-slate-50 font-bold"
            >
              →
            </button>

          </div>

        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">

          {/* ROOM FILTER */}
          <select
            value={
              selectedRoom === null
                ? "all"
                : String(selectedRoom)
            }
            onChange={(e) => {
              const value =
                e.target.value;

              setSelectedRoom(
                value === "all"
                  ? null
                  : Number(value),
              );
            }}
            className="input sm:max-w-xs"
          >
            <option value="all">
              All Meeting Rooms
            </option>

            {rooms.map((room) => (
              <option
                key={room.id}
                value={room.id}
              >
                {room.name}
              </option>
            ))}
          </select>

          {/* VIEW SWITCHER */}
          <div className="flex rounded-xl border border-slate-200 p-1 bg-slate-50">

            {(
              [
                ["day", "Day"],
                ["week", "Week"],
                ["month", "Month"],
              ] as const
            ).map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setView(value)
                  }
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                    view === value
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {label}
                </button>
              ),
            )}

          </div>

        </div>

        <div className="mt-4 text-lg font-bold">
          {title}
        </div>

      </div>

      {/* CALENDAR */}
      {view === "month" ? (
        <MonthView
          currentDate={currentDate}
          reservations={
            filteredReservations
          }
        />
      ) : (
        <TimeGrid
          days={visibleDays}
          reservations={
            filteredReservations
          }
        />
      )}

    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* TIME GRID */
/* -------------------------------------------------------------------------- */

function TimeGrid({
  days,
  reservations,
}: {
  days: Date[];
  reservations: Reservation[];
}) {
  const hours = Array.from(
    { length: 15 },
    (_, i) => i + 8,
  );

  return (
    <div className="card overflow-hidden">

      <div
        className="overflow-auto"
        style={{
          maxHeight: "calc(100vh - 260px)",
        }}
      >

        <div
          className="min-w-[900px] grid"
          style={{
            gridTemplateColumns:
              `80px repeat(${days.length}, minmax(180px, 1fr))`,
          }}
        >

          {/* HEADER */}
          <div className="sticky top-0 z-20 bg-white border-b border-r border-slate-200" />

          {days.map((day) => (
            <div
              key={day.toISOString()}
              className="sticky top-0 z-20 bg-white border-b border-slate-200 p-3 text-center"
            >
              <div className="text-xs uppercase text-slate-400 font-semibold">
                {day.toLocaleDateString(
                  "en-US",
                  {
                    weekday: "short",
                  },
                )}
              </div>

              <div
                className={`text-lg font-bold ${
                  sameDay(
                    day,
                    new Date(),
                  )
                    ? "text-indigo-600"
                    : "text-slate-800"
                }`}
              >
                {day.getDate()}
              </div>

              <div className="text-xs text-slate-400">
                {day.toLocaleDateString(
                  "en-US",
                  {
                    month: "short",
                  },
                )}
              </div>
            </div>
          ))}

          {/* HOURS */}
          {hours.map((hour) => (
            <div
              key={`row-${hour}`}
              className="contents"
            >
              <div className="border-r border-b border-slate-100 bg-slate-50 p-2 text-xs text-slate-400 text-right">
                {formatHour(hour)}
              </div>

              {days.map((day) => {

                const dayStart =
                  new Date(day);

                dayStart.setHours(
                  hour,
                  0,
                  0,
                  0,
                );

                const dayEnd =
                  new Date(day);

                dayEnd.setHours(
                  hour + 1,
                  0,
                  0,
                  0,
                );

                const events =
                  reservations.filter(
                    (reservation) =>
                      new Date(
                        reservation.startAt,
                      ) < dayEnd &&
                      new Date(
                        reservation.endAt,
                      ) > dayStart,
                  );

                return (
                  <div
                    key={`${day.toISOString()}-${hour}`}
                    className="relative min-h-[76px] border-b border-slate-100 bg-white p-1"
                  >
                    <div className="absolute inset-x-0 top-1/2 border-t border-slate-50" />

                    <div className="relative space-y-1">
                      {events.map(
                        (event) => (
                          <ReservationCard
                            key={
                              event.id
                            }
                            reservation={
                              event
                            }
                          />
                        ),
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

        </div>

      </div>

    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* MONTH VIEW */
/* -------------------------------------------------------------------------- */

function MonthView({
  currentDate,
  reservations,
}: {
  currentDate: Date;
  reservations: Reservation[];
}) {
  const days =
    getMonthGridDays(
      currentDate,
    );

  return (
    <div className="card overflow-hidden">

      <div className="grid grid-cols-7 border-b border-slate-200">

        {[
          "Sun",
          "Mon",
          "Tue",
          "Wed",
          "Thu",
          "Fri",
          "Sat",
        ].map((day) => (
          <div
            key={day}
            className="p-3 text-center text-xs font-bold uppercase text-slate-400 border-r border-slate-100 last:border-r-0"
          >
            {day}
          </div>
        ))}

      </div>

      <div className="grid grid-cols-7">

        {days.map((day) => {

          const events =
            reservations.filter(
              (reservation) =>
                sameDay(
                  new Date(
                    reservation.startAt,
                  ),
                  day,
                ),
            );

          const outsideMonth =
            day.getMonth() !==
            currentDate.getMonth();

          return (
            <div
              key={day.toISOString()}
              className={`min-h-[150px] p-2 border-r border-b border-slate-100 ${
                outsideMonth
                  ? "bg-slate-50"
                  : "bg-white"
              }`}
            >

              <div
                className={`text-sm font-bold mb-2 ${
                  sameDay(
                    day,
                    new Date(),
                  )
                    ? "text-indigo-600"
                    : "text-slate-700"
                }`}
              >
                {day.getDate()}
              </div>

              <div className="space-y-1">

                {events.map(
                  (event) => (
                    <ReservationCard
                      key={event.id}
                      reservation={
                        event
                      }
                      compact
                    />
                  ),
                )}

              </div>

            </div>
          );
        })}

      </div>

    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* RESERVATION CARD */
/* -------------------------------------------------------------------------- */

function ReservationCard({
  reservation,
  compact = false,
}: {
  reservation: Reservation;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-indigo-100 bg-indigo-50 ${
        compact
          ? "p-2"
          : "p-2.5"
      }`}
    >

      <div className="text-xs font-bold text-indigo-700 truncate">
        {reservation.roomName}
      </div>

      <div className="text-xs font-semibold text-slate-800 truncate">
        {reservation.customerName ||
          "Reservation"}
      </div>

      {!compact && (
        <>
          <div className="text-[11px] text-slate-500 mt-1">
            {formatTime(
              reservation.startAt,
            )}
            {" → "}
            {formatTime(
              reservation.endAt,
            )}
          </div>

          {reservation.customerPhone && (
            <div className="text-[11px] text-slate-500">
              📞{" "}
              {
                reservation.customerPhone
              }
            </div>
          )}
        </>
      )}

    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* HELPERS */
/* -------------------------------------------------------------------------- */

function getVisibleDays(
  date: Date,
  view: ViewMode,
) {
  if (view === "day") {
    return [startOfDay(date)];
  }

  const start =
    startOfWeek(date);

  return Array.from(
    { length: 7 },
    (_, i) => {
      const day =
        new Date(start);

      day.setDate(
        day.getDate() + i,
      );

      return day;
    },
  );
}

function getMonthGridDays(
  date: Date,
) {
  const first = new Date(
    date.getFullYear(),
    date.getMonth(),
    1,
  );

  const start =
    startOfWeek(first);

  return Array.from(
    { length: 42 },
    (_, i) => {
      const day =
        new Date(start);

      day.setDate(
        day.getDate() + i,
      );

      return day;
    },
  );
}

function startOfDay(
  date: Date,
) {
  const result = new Date(date);

  result.setHours(
    0,
    0,
    0,
    0,
  );

  return result;
}

function startOfWeek(
  date: Date,
) {
  const result =
    startOfDay(date);

  const day =
    result.getDay();

  result.setDate(
    result.getDate() - day,
  );

  return result;
}

function sameDay(
  a: Date,
  b: Date,
) {
  return (
    a.getFullYear() ===
      b.getFullYear() &&
    a.getMonth() ===
      b.getMonth() &&
    a.getDate() ===
      b.getDate()
  );
}

function formatTime(
  value: string,
) {
  return new Date(
    value,
  ).toLocaleTimeString(
    "en-EG",
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    },
  );
}

function formatHour(
  hour: number,
) {
  const date =
    new Date();

  date.setHours(
    hour,
    0,
    0,
    0,
  );

  return date.toLocaleTimeString(
    "en-EG",
    {
      hour: "numeric",
      hour12: true,
    },
  );
}

function getCalendarTitle(
  date: Date,
  view: ViewMode,
) {
  if (view === "day") {
    return date.toLocaleDateString(
      "en-US",
      {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      },
    );
  }

  if (view === "month") {
    return date.toLocaleDateString(
      "en-US",
      {
        month: "long",
        year: "numeric",
      },
    );
  }

  const start =
    startOfWeek(date);

  const end =
    new Date(start);

  end.setDate(
    end.getDate() + 6,
  );

  return `${start.toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
    },
  )} – ${end.toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  )}`;
}