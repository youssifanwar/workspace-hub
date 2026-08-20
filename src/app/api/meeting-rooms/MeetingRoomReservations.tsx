"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

type Room = {
  id: number;
  name: string;
  hourlyRate: string;
};

type Props = {
  rooms: Room[];
  currency: string;
};

function toLocalInput(
  date: Date,
) {
  const pad = (n: number) =>
    String(n).padStart(2, "0");

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

export default function MeetingRoomReservations({
  rooms,
  currency,
}: Props) {
  const [roomId, setRoomId] =
    useState<number>(
      rooms[0]?.id ?? 0,
    );

  const [startAt, setStartAt] =
    useState("");

  const [endAt, setEndAt] =
    useState("");

  const [customerName, setCustomerName] =
    useState("");

  const [customerPhone, setCustomerPhone] =
    useState("");

  const [notes, setNotes] =
    useState("");

  const [recurrence, setRecurrence] =
    useState<
      "none" | "weekly"
    >("none");

  const [recurrenceCount, setRecurrenceCount] =
    useState("4");

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

  const [message, setMessage] =
    useState<string | null>(
      null,
    );

  useEffect(() => {
    const now =
      new Date();

    now.setMinutes(
      now.getMinutes() + 30,
    );

    const end =
      new Date(now);

    end.setHours(
      end.getHours() + 1,
    );

    setStartAt(
      toLocalInput(now),
    );

    setEndAt(
      toLocalInput(end),
    );
  }, []);

  const selectedRoom =
    useMemo(
      () =>
        rooms.find(
          (room) =>
            room.id === roomId,
        ),
      [rooms, roomId],
    );

  async function checkAvailability() {
    setChecking(true);
    setAvailable(null);
    setError(null);
    setMessage(null);

    try {
      if (
        !roomId ||
        !startAt ||
        !endAt
      ) {
        setError(
          "Choose room, date and time first.",
        );
        return;
      }

      const params =
        new URLSearchParams({
          deskId:
            String(roomId),

          startAt:
            new Date(
              startAt,
            ).toISOString(),

          endAt:
            new Date(
              endAt,
            ).toISOString(),
        });

      const res =
        await fetch(
          `/api/meeting-rooms/availability?${params.toString()}`,
          {
            cache: "no-store",
          },
        );

      const data =
        await res.json();

      if (!res.ok) {
        setError(
          data.error ||
            "Could not check availability.",
        );
        return;
      }

      setAvailable(
        Boolean(
          data.available,
        ),
      );
    } catch {
      setError(
        "Could not check Google Calendar.",
      );
    } finally {
      setChecking(false);
    }
  }

  async function reserve() {
    setChecking(true);
    setAvailable(null);
    setError(null);
    setMessage(null);

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
                roomId,

              customerName:
                customerName.trim(),

              customerPhone:
                customerPhone.trim(),

              startAt:
                new Date(
                  startAt,
                ).toISOString(),

              endAt:
                new Date(
                  endAt,
                ).toISOString(),

              recurrence,

              recurrenceCount:
                Number(
                  recurrenceCount,
                ),

              notes:
                notes.trim(),
            }),
          },
        );

      const data =
        await res.json();

      if (!res.ok) {
        setError(
          data.error ||
            "Could not create reservation.",
        );
        return;
      }

      setMessage(
        `✅ ${selectedRoom?.name} booked successfully.`,
      );

      setAvailable(true);

      setCustomerName("");
      setCustomerPhone("");
      setNotes("");
    } catch {
      setError(
        "Could not create reservation.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="card p-6 mt-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-slate-900">
          📅 Meeting Room Reservations
        </h2>

        <p className="text-sm text-slate-500 mt-1">
          Check Google Calendar before
          confirming a room reservation.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">

        <div>
          <label className="text-sm font-semibold">
            Meeting room
          </label>

          <select
            value={roomId}
            onChange={(e) => {
              setRoomId(
                Number(
                  e.target.value,
                ),
              );

              setAvailable(null);
            }}
            className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2"
          >
            {rooms.map(
              (room) => (
                <option
                  key={room.id}
                  value={room.id}
                >
                  {room.name}
                </option>
              ),
            )}
          </select>
        </div>

        <div>
          <label className="text-sm font-semibold">
            Customer name
          </label>

          <input
            value={
              customerName
            }
            onChange={(e) =>
              setCustomerName(
                e.target.value,
              )
            }
            className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2"
            placeholder="Customer name"
          />
        </div>

        <div>
          <label className="text-sm font-semibold">
            Phone
          </label>

          <input
            value={
              customerPhone
            }
            onChange={(e) =>
              setCustomerPhone(
                e.target.value,
              )
            }
            className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2"
            placeholder="01xxxxxxxxx"
          />
        </div>

        <div>
          <label className="text-sm font-semibold">
            Start
          </label>

          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => {
              setStartAt(
                e.target.value,
              );
              setAvailable(null);
            }}
            className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2"
          />
        </div>

        <div>
          <label className="text-sm font-semibold">
            End
          </label>

          <input
            type="datetime-local"
            value={endAt}
            onChange={(e) => {
              setEndAt(
                e.target.value,
              );
              setAvailable(null);
            }}
            className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2"
          />
        </div>

        <div>
          <label className="text-sm font-semibold">
            Repeat
          </label>

          <select
            value={recurrence}
            onChange={(e) => {
              setRecurrence(
                e.target
                  .value as
                  | "none"
                  | "weekly",
              );
            }}
            className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2"
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
            <label className="text-sm font-semibold">
              Number of weeks
            </label>

            <input
              type="number"
              min={1}
              max={52}
              value={
                recurrenceCount
              }
              onChange={(e) =>
                setRecurrenceCount(
                  e.target.value,
                )
              }
              className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2"
            />
          </div>
        )}

        <div className="md:col-span-2">
          <label className="text-sm font-semibold">
            Notes
          </label>

          <textarea
            value={notes}
            onChange={(e) =>
              setNotes(
                e.target.value,
              )
            }
            className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2"
            rows={3}
            placeholder="Optional notes"
          />
        </div>

      </div>

      <div className="flex items-center gap-3 flex-wrap mt-5">

        <button
          onClick={
            checkAvailability
          }
          disabled={
            checking
          }
          className="btn btn-ghost"
        >
          {checking
            ? "Checking…"
            : "Check availability"}
        </button>

        <button
          onClick={reserve}
          disabled={
            checking ||
            !customerName.trim() ||
            !customerPhone.trim()
          }
          className="btn btn-primary"
        >
          Confirm reservation
        </button>

      </div>

      {available ===
        true && (
        <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
          🟢 Room is available.
        </div>
      )}

      {available ===
        false && (
        <div className="mt-4 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 font-semibold">
          🔴 Room is already booked
          for this time.
        </div>
      )}

      {message && (
        <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
          {message}
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      )}

      {selectedRoom && (
        <div className="mt-4 text-xs text-slate-400">
          Rate:{" "}
          {parseFloat(
            selectedRoom.hourlyRate,
          ).toFixed(2)}{" "}
          {currency}/hour
        </div>
      )}
    </div>
  );
}