"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CheckInModal from "../bookings/CheckInModal";

type Room = {
  id: number;
  name: string;
  hourlyRate: string;
};

type Occ = {
  id: number;
  customerName: string;
  customerPhone: string;
  checkedInAt: string;
  hourlyRate: string;
};

type ReservationModalProps = {
  room: Room;
  currency: string;
  onClose: () => void;
};

export default function RoomsGrid({
  rooms,
  occupancy,
  currency,
  canEditRate,
}: {
  rooms: Room[];
  occupancy: Record<number, Occ>;
  currency: string;
  canEditRate: boolean;
}) {
  const router = useRouter();

  const [now, setNow] = useState<Date>(
    new Date(),
  );

  const [checkInRoom, setCheckInRoom] =
    useState<Room | null>(null);

  const [reservationRoom, setReservationRoom] =
    useState<Room | null>(null);

  const [editing, setEditing] =
    useState<number | null>(null);

  const [editValue, setEditValue] =
    useState("");

  useEffect(() => {
    const t = setInterval(
      () => setNow(new Date()),
      1000,
    );

    return () => clearInterval(t);
  }, []);

  async function saveRate(roomId: number) {
    const rate =
      parseFloat(editValue);

    if (
      Number.isNaN(rate) ||
      rate < 0
    ) {
      return;
    }

    const res = await fetch(
      `/api/desks/${roomId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          hourlyRate: rate,
        }),
      },
    );

    if (res.ok) {
      setEditing(null);
      router.refresh();
    }
  }

  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {rooms.map((r) => {
          const o = occupancy[r.id];

          const isEditing =
            editing === r.id;

          /*
           * -------------------------------------------------------------------
           * AVAILABLE ROOM
           * -------------------------------------------------------------------
           */
          if (!o) {
            return (
              <div
                key={r.id}
                className="card p-6 flex flex-col gap-3 hover:border-indigo-300 transition"
              >
                <div className="flex items-center justify-between">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-white grid place-items-center text-2xl">
                    👥
                  </div>

                  <span className="badge badge-green">
                    Available
                  </span>
                </div>

                <div>
                  <div className="text-lg font-bold">
                    {r.name}
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={editValue}
                        onChange={(e) =>
                          setEditValue(
                            e.target.value,
                          )
                        }
                        autoFocus
                      />

                      <button
                        className="btn btn-primary"
                        onClick={() =>
                          saveRate(r.id)
                        }
                      >
                        Save
                      </button>

                      <button
                        className="btn btn-ghost"
                        onClick={() =>
                          setEditing(null)
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-slate-600 text-sm">
                        {parseFloat(
                          r.hourlyRate,
                        ).toFixed(2)}{" "}
                        {currency} / hour
                      </span>

                      {canEditRate && (
                        <button
                          onClick={() => {
                            setEditing(
                              r.id,
                            );

                            setEditValue(
                              parseFloat(
                                r.hourlyRate,
                              ).toString(),
                            );
                          }}
                          className="text-xs text-indigo-600 font-semibold hover:underline"
                        >
                          ✏️ edit
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* CURRENT CHECK-IN */}
                <button
                  className="btn btn-primary mt-auto"
                  onClick={() =>
                    setCheckInRoom(r)
                  }
                >
                  Start timer →
                </button>

                {/* FUTURE RESERVATION */}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    setReservationRoom(r)
                  }
                >
                  📅 Reserve for a date
                </button>
              </div>
            );
          }

          /*
           * -------------------------------------------------------------------
           * OCCUPIED ROOM
           * -------------------------------------------------------------------
           */

          const startMs =
            new Date(
              o.checkedInAt,
            ).getTime();

          const dur =
            now.getTime() -
            startMs;

          const curCharge =
            (dur /
              3_600_000) *
            parseFloat(
              o.hourlyRate,
            );

          return (
            <Link
              key={r.id}
              href={`/bookings/${o.id}`}
              className="card p-6 bg-gradient-to-br from-rose-500 to-pink-500 text-white border-0 hover:scale-[1.01] transition flex flex-col gap-3"
            >
              <div className="flex items-center justify-between">
                <div className="w-14 h-14 rounded-2xl bg-white/20 grid place-items-center text-2xl">
                  👥
                </div>

                <span className="text-xs font-bold bg-white/25 px-2 py-1 rounded-full">
                  Occupied
                </span>
              </div>

              <div>
                <div className="text-lg font-bold">
                  {r.name}
                </div>

                <div className="text-sm opacity-90 truncate">
                  {o.customerName}
                </div>

                <div className="text-xs opacity-80">
                  📞 {o.customerPhone}
                </div>
              </div>

              <div className="pt-2 border-t border-white/25 flex items-end justify-between">
                <div>
                  <div className="text-xs opacity-75">
                    Elapsed
                  </div>

                  <div className="text-xl font-bold tabular-nums">
                    {formatDur(
                      dur,
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs opacity-75">
                    Charge
                  </div>

                  <div className="text-xl font-bold tabular-nums">
                    {curCharge.toFixed(
                      2,
                    )}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* CURRENT CHECK-IN MODAL */}
      {checkInRoom && (
        <CheckInModal
          desk={checkInRoom}
          currency={currency}
          onClose={() =>
            setCheckInRoom(
              null,
            )
          }
        />
      )}

      {/* FUTURE GOOGLE CALENDAR RESERVATION MODAL */}
      {reservationRoom && (
        <ReservationModal
          room={reservationRoom}
          currency={currency}
          onClose={() =>
            setReservationRoom(
              null,
            )
          }
        />
      )}
    </>
  );
}

/* -----------------------------------------------------------------------------
 * RESERVATION MODAL
 * -------------------------------------------------------------------------- */

function ReservationModal({
  room,
  currency,
  onClose,
}: ReservationModalProps) {
  const [customerName, setCustomerName] =
    useState("");

  const [customerPhone, setCustomerPhone] =
    useState("");

  const [startAt, setStartAt] =
    useState("");

  const [endAt, setEndAt] =
    useState("");

  const [recurrence, setRecurrence] =
    useState<
      "none" | "weekly"
    >("none");

  const [recurrenceCount, setRecurrenceCount] =
    useState("4");

  const [notes, setNotes] =
    useState("");

  const [checking, setChecking] =
    useState(false);

  const [available, setAvailable] =
    useState<boolean | null>(
      null,
    );

  const [error, setError] =
    useState<string | null>(
      null,
    );

  const [success, setSuccess] =
    useState<string | null>(
      null,
    );

  useEffect(() => {
    const now =
      new Date();

    // Round to next 30 minutes.
    now.setSeconds(0);
    now.setMilliseconds(0);

    const minutes =
      now.getMinutes();

    const rounded =
      minutes < 30
        ? 30
        : 60;

    if (rounded === 60) {
      now.setHours(
        now.getHours() + 1,
      );
      now.setMinutes(0);
    } else {
      now.setMinutes(30);
    }

    const end =
      new Date(now);

    end.setHours(
      end.getHours() + 1,
    );

    setStartAt(
      toDateTimeLocal(
        now,
      ),
    );

    setEndAt(
      toDateTimeLocal(
        end,
      ),
    );
  }, []);

  function resetMessages() {
    setError(null);
    setSuccess(null);
    setAvailable(null);
  }

  function getDates() {
    const start =
      new Date(
        startAt,
      );

    const end =
      new Date(
        endAt,
      );

    return {
      start,
      end,
    };
  }

  async function checkAvailability() {
    resetMessages();

    if (
      !startAt ||
      !endAt
    ) {
      setError(
        "Choose the start and end time.",
      );
      return;
    }

    const {
      start,
      end,
    } = getDates();

    if (
      Number.isNaN(
        start.getTime(),
      ) ||
      Number.isNaN(
        end.getTime(),
      ) ||
      end <= start
    ) {
      setError(
        "Please enter a valid time range.",
      );
      return;
    }

    setChecking(true);

    try {
      const params =
        new URLSearchParams({
          deskId:
            String(room.id),

          startAt:
            start.toISOString(),

          endAt:
            end.toISOString(),
        });

      const res =
        await fetch(
          `/api/meeting-rooms/availability?${params.toString()}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

      const data =
        await res
          .json()
          .catch(
            () => ({}),
          );

      if (!res.ok) {
        setError(
          data.error ||
            `Could not check availability (HTTP ${res.status}).`,
        );
        return;
      }

      setAvailable(
        Boolean(
          data.available,
        ),
      );
    } catch (err) {
      console.error(
        "Availability error:",
        err,
      );

      setError(
        "Could not connect to Google Calendar.",
      );
    } finally {
      setChecking(false);
    }
  }

  async function reserve() {
    resetMessages();

    if (
      !customerName.trim()
    ) {
      setError(
        "Customer name is required.",
      );
      return;
    }

    if (
      !customerPhone.trim()
    ) {
      setError(
        "Customer phone is required.",
      );
      return;
    }

    if (
      !startAt ||
      !endAt
    ) {
      setError(
        "Choose the start and end time.",
      );
      return;
    }

    const {
      start,
      end,
    } = getDates();

    if (
      Number.isNaN(
        start.getTime(),
      ) ||
      Number.isNaN(
        end.getTime(),
      ) ||
      end <= start
    ) {
      setError(
        "Please enter a valid time range.",
      );
      return;
    }

    if (
      start <=
      new Date()
    ) {
      setError(
        "Reservation must be in the future.",
      );
      return;
    }

    if (
      recurrence ===
      "weekly"
    ) {
      const count =
        Number(
          recurrenceCount,
        );

      if (
        !Number.isInteger(
          count,
        ) ||
        count < 1 ||
        count > 52
      ) {
        setError(
          "Number of weeks must be between 1 and 52.",
        );
        return;
      }
    }

    setChecking(true);

    try {
      const res =
        await fetch(
          "/api/meeting-rooms/reservations",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              deskId:
                room.id,

              customerName:
                customerName.trim(),

              customerPhone:
                customerPhone.trim(),

              startAt:
                start.toISOString(),

              endAt:
                end.toISOString(),

              recurrence,

              recurrenceCount:
                recurrence ===
                "weekly"
                  ? Number(
                      recurrenceCount,
                    )
                  : 1,

              notes:
                notes.trim() ||
                undefined,
            }),
          },
        );

      const data =
        await res
          .json()
          .catch(
            () => ({}),
          );

      if (!res.ok) {
        if (
          res.status === 409
        ) {
          setAvailable(false);
        }

        setError(
          data.error ||
            `Could not create reservation (HTTP ${res.status}).`,
        );

        return;
      }

      setAvailable(true);

      setSuccess(
        recurrence ===
          "weekly"
          ? `${room.name} was reserved successfully for ${data.recurrenceCount ?? Number(recurrenceCount)} weeks.`
          : `${room.name} was reserved successfully.`,
      );

      // Clear customer fields after success.
      setCustomerName("");
      setCustomerPhone("");
      setNotes("");
    } catch (err) {
      console.error(
        "Reservation error:",
        err,
      );

      setError(
        "Could not create reservation.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">

        {/* HEADER */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold tracking-wider text-indigo-600">
              GOOGLE CALENDAR RESERVATION
            </div>

            <h2 className="text-2xl font-bold text-slate-900 mt-1">
              {room.name}
            </h2>

            <div className="text-sm text-slate-500 mt-1">
              {parseFloat(
                room.hourlyRate,
              ).toFixed(2)}{" "}
              {currency} / hour
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* BODY */}
        <div className="p-6 space-y-5">

          {/* CUSTOMER */}
          <div className="grid md:grid-cols-2 gap-4">

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Customer name
              </label>

              <input
                className="input w-full"
                value={
                  customerName
                }
                onChange={(e) => {
                  setCustomerName(
                    e.target.value,
                  );
                  resetMessages();
                }}
                placeholder="e.g. Ahmed Ali"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Phone number
              </label>

              <input
                className="input w-full"
                value={
                  customerPhone
                }
                onChange={(e) => {
                  setCustomerPhone(
                    e.target.value,
                  );
                  resetMessages();
                }}
                placeholder="e.g. 0100 000 0000"
              />
            </div>

          </div>

          {/* DATE/TIME */}
          <div className="grid md:grid-cols-2 gap-4">

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Start
              </label>

              <input
                type="datetime-local"
                className="input w-full"
                value={
                  startAt
                }
                onChange={(e) => {
                  setStartAt(
                    e.target.value,
                  );
                  resetMessages();
                }}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                End
              </label>

              <input
                type="datetime-local"
                className="input w-full"
                value={
                  endAt
                }
                onChange={(e) => {
                  setEndAt(
                    e.target.value,
                  );
                  resetMessages();
                }}
              />
            </div>

          </div>

          {/* RECURRENCE */}
          <div className="grid md:grid-cols-2 gap-4">

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Repeat
              </label>

              <select
                className="input w-full"
                value={
                  recurrence
                }
                onChange={(e) => {
                  setRecurrence(
                    e.target
                      .value as
                      | "none"
                      | "weekly",
                  );

                  resetMessages();
                }}
              >
                <option value="none">
                  One time
                </option>

                <option value="weekly">
                  Every week
                </option>
              </select>
            </div>

            {recurrence ===
              "weekly" && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Number of weeks
                </label>

                <input
                  type="number"
                  min={1}
                  max={52}
                  className="input w-full"
                  value={
                    recurrenceCount
                  }
                  onChange={(e) => {
                    setRecurrenceCount(
                      e.target.value,
                    );
                    resetMessages();
                  }}
                />
              </div>
            )}

          </div>

          {/* NOTES */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Notes
            </label>

            <textarea
              className="input w-full min-h-24"
              value={notes}
              onChange={(e) => {
                setNotes(
                  e.target.value,
                );
                resetMessages();
              }}
              placeholder="Optional notes"
            />
          </div>

          {/* STATUS */}
          {available === true && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 font-semibold">
              🟢 This room is available for
              the selected time.
            </div>
          )}

          {available === false && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 font-semibold">
              🔴 This room is not available
              for the selected time.
            </div>
          )}

          {success && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 font-semibold whitespace-pre-wrap">
              {success}
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 whitespace-pre-wrap">
              {error}
            </div>
          )}

        </div>

        {/* FOOTER */}
        <div className="p-6 border-t border-slate-100 flex flex-col sm:flex-row gap-3 sm:justify-end">

          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={checking}
          >
            Close
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={
              checkAvailability
            }
            disabled={checking}
          >
            {checking
              ? "Checking..."
              : "Check availability"}
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={reserve}
            disabled={checking}
          >
            {checking
              ? "Processing..."
              : "Confirm reservation →"}
          </button>

        </div>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * HELPERS
 * -------------------------------------------------------------------------- */

function formatDur(
  ms: number,
): string {
  const s = Math.floor(
    ms / 1000,
  );

  const h = Math.floor(
    s / 3600,
  );

  const m = Math.floor(
    (s % 3600) / 60,
  );

  const sec = s % 60;

  return `${String(
    h,
  ).padStart(2, "0")}:${String(
    m,
  ).padStart(2, "0")}:${String(
    sec,
  ).padStart(2, "0")}`;
}

function toDateTimeLocal(
  date: Date,
): string {
  const pad = (value: number) =>
    String(value).padStart(
      2,
      "0",
    );

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1,
  )}-${pad(
    date.getDate(),
  )}T${pad(
    date.getHours(),
  )}:${pad(
    date.getMinutes(),
  )}`;
}