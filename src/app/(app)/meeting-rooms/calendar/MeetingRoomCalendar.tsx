"use client";

import {
  useMemo,
  useState,
} from "react";

import { useRouter } from "next/navigation";

/* ============================================================================
 * TYPES
 * ========================================================================== */

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

/* ============================================================================
 * HELPERS
 * ========================================================================== */

function safeDate(
  value: string | Date | null | undefined,
): Date | null {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  return date;
}

function formatDateTime(
  value: string,
): string {
  const date = safeDate(value);

  if (!date) {
    return "-";
  }

  return date.toLocaleString(
    "en-EG",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    },
  );
}

function formatTime(
  value: string,
): string {
  const date = safeDate(value);

  if (!date) {
    return "-";
  }

  return date.toLocaleTimeString(
    "en-EG",
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    },
  );
}

function calculateDuration(
  startAt: string,
  endAt: string,
): number | null {
  const start = safeDate(startAt);
  const end = safeDate(endAt);

  if (!start || !end) {
    return null;
  }

  const milliseconds =
    end.getTime() -
    start.getTime();

  if (
    !Number.isFinite(
      milliseconds,
    ) ||
    milliseconds < 0
  ) {
    return null;
  }

  return milliseconds / 3_600_000;
}

function getReservationStatusLabel(
  status: string,
): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";

    case "active":
      return "Active";

    case "cancelled":
      return "Cancelled";

    case "completed":
      return "Completed";

    case "pending":
      return "Pending";

    default:
      return status || "Unknown";
  }
}

function getReservationStatusClass(
  status: string,
): string {
  switch (status) {
    case "confirmed":
      return "bg-emerald-100 text-emerald-700";

    case "active":
      return "bg-indigo-100 text-indigo-700";

    case "cancelled":
      return "bg-red-100 text-red-700";

    case "completed":
      return "bg-slate-200 text-slate-600";

    case "pending":
      return "bg-amber-100 text-amber-700";

    default:
      return "bg-slate-100 text-slate-600";
  }
}

function sameDay(
  a: Date,
  b: Date,
): boolean {
  return (
    a.getFullYear() ===
      b.getFullYear() &&
    a.getMonth() ===
      b.getMonth() &&
    a.getDate() ===
      b.getDate()
  );
}

function uniqueReservations(
  reservations: Reservation[],
): Reservation[] {
  const seen =
    new Set<number>();

  const result: Reservation[] =
    [];

  for (const reservation of reservations) {
    if (
      seen.has(
        reservation.id,
      )
    ) {
      continue;
    }

    seen.add(
      reservation.id,
    );

    result.push(
      reservation,
    );
  }

  return result;
}

/* ============================================================================
 * MAIN COMPONENT
 * ========================================================================== */

export default function MeetingRoomCalendar({
  rooms,
  reservations,
}: {
  rooms: Room[];
  reservations: Reservation[];
}) {
  const router = useRouter();

  const [view, setView] =
    useState<ViewMode>("week");

  const [selectedRoom, setSelectedRoom] =
    useState<number | null>(null);

  const [currentDate, setCurrentDate] =
    useState(() =>
      new Date(),
    );

  const [selectedReservation, setSelectedReservation] =
    useState<Reservation | null>(
      null,
    );

  const [cancellingId, setCancellingId] =
    useState<number | null>(
      null,
    );

  const [checkingInId, setCheckingInId] =
    useState<number | null>(
      null,
    );

  const [
    actionMessage,
    setActionMessage,
  ] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const filteredReservations =
    useMemo(() => {
      if (
        selectedRoom === null
      ) {
        return reservations;
      }

      return reservations.filter(
        (reservation) =>
          reservation.deskId ===
          selectedRoom,
      );
    }, [
      reservations,
      selectedRoom,
    ]);

  const sortedReservations =
    useMemo(() => {
      return [
        ...filteredReservations,
      ].sort(
        (first, second) => {
          const firstTime =
            safeDate(
              first.startAt,
            )?.getTime() ?? 0;

          const secondTime =
            safeDate(
              second.startAt,
            )?.getTime() ?? 0;

          if (
            firstTime !==
            secondTime
          ) {
            return (
              firstTime -
              secondTime
            );
          }

          return (
            first.id -
            second.id
          );
        },
      );
    }, [
      filteredReservations,
    ]);

  const visibleDays =
    useMemo(
      () =>
        getVisibleDays(
          currentDate,
          view,
        ),
      [currentDate, view],
    );

  function movePrevious() {
    setCurrentDate(
      moveCalendarDate(
        currentDate,
        view,
        -1,
      ),
    );
  }

  function moveNext() {
    setCurrentDate(
      moveCalendarDate(
        currentDate,
        view,
        1,
      ),
    );
  }

  function goToday() {
    setCurrentDate(
      new Date(),
    );
  }

  function openReservation(
    reservation: Reservation,
  ) {
    setActionMessage(null);
    setSelectedReservation(
      reservation,
    );
  }

  function closeReservation() {
    if (
      cancellingId !== null
    ) {
      return;
    }

    setSelectedReservation(
      null,
    );
  }

  async function checkInReservation(
    reservation: Reservation,
  ) {
    if (
      checkingInId !== null ||
      cancellingId !== null ||
      reservation.status !== "confirmed"
    ) {
      return;
    }

    const start = safeDate(reservation.startAt);

    if (start && start.getTime() > Date.now()) {
      setActionMessage({
        type: "error",
        text: `Check-in is available from ${formatTime(reservation.startAt)}.`,
      });
      return;
    }

    const confirmed = window.confirm(
      `Check in ${reservation.customerName || "this customer"} to ${reservation.roomName}?`,
    );

    if (!confirmed) {
      return;
    }

    setCheckingInId(reservation.id);
    setActionMessage(null);

    try {
      const response = await fetch(
        `/api/meeting-rooms/reservations/${reservation.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ action: "check_in" }),
          cache: "no-store",
        },
      );

      let data: unknown = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        let message = `Could not check in reservation (HTTP ${response.status}).`;

        if (
          data !== null &&
          typeof data === "object" &&
          !Array.isArray(data)
        ) {
          const payload = data as Record<string, unknown>;
          if (typeof payload.error === "string" && payload.error.trim()) {
            message = payload.error.trim();
          }
        }

        setActionMessage({ type: "error", text: message });
        return;
      }

      setSelectedReservation(null);
      setActionMessage({
        type: "success",
        text: `Reservation #${reservation.id} checked in successfully.`,
      });
      router.refresh();
    } catch {
      setActionMessage({
        type: "error",
        text: "Could not connect to the reservation service.",
      });
    } finally {
      setCheckingInId(null);
    }
  }

  async function cancelReservation(
    reservation: Reservation,
  ) {
    if (
      cancellingId !== null ||
      reservation.status !==
        "confirmed"
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        `Cancel reservation #${reservation.id} for ${
          reservation.customerName ||
          "this customer"
        } in ${reservation.roomName}?`,
      );

    if (!confirmed) {
      return;
    }

    setCancellingId(
      reservation.id,
    );

    setActionMessage(null);

    try {
      const response =
        await fetch(
          `/api/meeting-rooms/reservations/${reservation.id}`,
          {
            method: "DELETE",
            headers: {
              Accept:
                "application/json",
            },
            cache: "no-store",
          },
        );

      let data: unknown = null;

      try {
        data =
          await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        let message =
          `Could not cancel reservation (HTTP ${response.status}).`;

        if (
          data !== null &&
          typeof data ===
            "object" &&
          !Array.isArray(data)
        ) {
          const payload =
            data as Record<
              string,
              unknown
            >;

          if (
            typeof payload.error ===
              "string" &&
            payload.error.trim()
          ) {
            message =
              payload.error.trim();
          } else if (
            typeof payload.message ===
              "string" &&
            payload.message.trim()
          ) {
            message =
              payload.message.trim();
          }
        }

        setActionMessage({
          type: "error",
          text: message,
        });

        return;
      }

      setSelectedReservation(
        null,
      );

      setActionMessage({
        type: "success",
        text: `Reservation #${reservation.id} was cancelled successfully.`,
      });

      router.refresh();
    } catch {
      setActionMessage({
        type: "error",
        text:
          "Could not connect to the reservation service.",
      });
    } finally {
      setCancellingId(null);
    }
  }

  const title =
    getCalendarTitle(
      currentDate,
      view,
    );

  return (
    <div className="space-y-5">
      {/* ================================================================== */}
      {/* HEADER                                                             */}
      {/* ================================================================== */}

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
              View scheduled meeting-room reservations,
              customer details and manage cancellations.
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
              aria-label="Previous period"
            >
              ←
            </button>

            <button
              type="button"
              onClick={moveNext}
              className="w-10 h-10 rounded-xl border border-slate-200 hover:bg-slate-50 font-bold"
              aria-label="Next period"
            >
              →
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          {/* ROOM FILTER */}
          <select
            value={
              selectedRoom ===
              null
                ? "all"
                : String(
                    selectedRoom,
                  )
            }
            onChange={(event) => {
              const value =
                event.target.value;

              setSelectedRoom(
                value === "all"
                  ? null
                  : Number(value),
              );
            }}
            className="input sm:max-w-xs"
            aria-label="Filter by meeting room"
          >
            <option value="all">
              All Meeting Rooms
            </option>

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

          {/* VIEW SWITCHER */}
          <div className="flex rounded-xl border border-slate-200 p-1 bg-slate-50">
            {(
              [
                ["day", "Day"],
                [
                  "week",
                  "Week",
                ],
                [
                  "month",
                  "Month",
                ],
              ] as const
            ).map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setView(
                      value,
                    )
                  }
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                    view === value
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                  aria-pressed={
                    view === value
                  }
                >
                  {label}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-lg font-bold">
            {title}
          </div>

          <div className="text-sm text-slate-500">
            {filteredReservations.length}{" "}
            reservation
            {filteredReservations.length ===
            1
              ? ""
              : "s"}
          </div>
        </div>
      </div>

      {/* ACTION MESSAGE */}
      {actionMessage && (
        <div
          className={`rounded-2xl border p-4 ${
            actionMessage.type ===
            "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
          role="alert"
        >
          {actionMessage.text}
        </div>
      )}

      {/* ================================================================== */}
      {/* CALENDAR                                                           */}
      {/* ================================================================== */}

      {view === "month" ? (
        <MonthView
          currentDate={
            currentDate
          }
          reservations={
            filteredReservations
          }
          onSelectReservation={
            openReservation
          }
        />
      ) : (
        <TimeGrid
          days={visibleDays}
          reservations={
            filteredReservations
          }
          onSelectReservation={
            openReservation
          }
        />
      )}

      {/* ================================================================== */}
      {/* RESERVATION TABLE                                                  */}
      {/* ================================================================== */}

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Reservations
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              All upcoming confirmed reservations for
              the selected room filter.
            </p>
          </div>

          <div className="text-sm font-semibold text-slate-600">
            {sortedReservations.length}
          </div>
        </div>

        {sortedReservations.length ===
        0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center">
            <div
              className="text-4xl mb-2"
              aria-hidden="true"
            >
              📅
            </div>

            <div className="font-semibold text-slate-700">
              No upcoming reservations
            </div>

            <div className="text-sm text-slate-400 mt-1">
              Reservations will appear here once
              they are created.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
                  <th className="py-3 pr-4">
                    #
                  </th>

                  <th className="py-3 pr-4">
                    Customer
                  </th>

                  <th className="py-3 pr-4">
                    Room
                  </th>

                  <th className="py-3 pr-4">
                    Start
                  </th>

                  <th className="py-3 pr-4">
                    End
                  </th>

                  <th className="py-3 pr-4">
                    Duration
                  </th>

                  <th className="py-3 pr-4">
                    Status
                  </th>

                  <th className="py-3 text-right">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {sortedReservations.map(
                  (reservation) => {
                    const duration =
                      calculateDuration(
                        reservation.startAt,
                        reservation.endAt,
                      );

                    const canCancel =
                      reservation.status ===
                      "confirmed";

                    const isCancelling =
                      cancellingId ===
                      reservation.id;

                    return (
                      <tr
                        key={
                          reservation.id
                        }
                        className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                      >
                        <td className="py-3 pr-4 font-semibold text-slate-700">
                          #
                          {
                            reservation.id
                          }
                        </td>

                        <td className="py-3 pr-4">
                          <div className="font-semibold text-slate-900">
                            {reservation.customerName ||
                              "Unknown customer"}
                          </div>

                          {reservation.customerPhone && (
                            <div className="text-xs text-slate-500 mt-0.5">
                              {reservation.customerPhone}
                            </div>
                          )}
                        </td>

                        <td className="py-3 pr-4">
                          {reservation.roomName ||
                            "-"}
                        </td>

                        <td className="py-3 pr-4 whitespace-nowrap">
                          {formatDateTime(
                            reservation.startAt,
                          )}
                        </td>

                        <td className="py-3 pr-4 whitespace-nowrap">
                          {formatDateTime(
                            reservation.endAt,
                          )}
                        </td>

                        <td className="py-3 pr-4 whitespace-nowrap">
                          {duration !==
                          null
                            ? `${duration} h`
                            : "-"}
                        </td>

                        <td className="py-3 pr-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${getReservationStatusClass(
                              reservation.status,
                            )}`}
                          >
                            {getReservationStatusLabel(
                              reservation.status,
                            )}
                          </span>
                        </td>

                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="btn btn-ghost !py-1.5 !px-3 text-xs"
                              onClick={() =>
                                openReservation(
                                  reservation,
                                )
                              }
                            >
                              View
                            </button>

                            {reservation.status === "confirmed" &&
                              (safeDate(reservation.startAt)?.getTime() ?? Number.POSITIVE_INFINITY) <= Date.now() && (
                              <button
                                type="button"
                                className="btn btn-primary !py-1.5 !px-3 text-xs"
                                onClick={() =>
                                  void checkInReservation(reservation)
                                }
                                disabled={
                                  checkingInId !== null ||
                                  cancellingId !== null
                                }
                              >
                                {checkingInId === reservation.id
                                  ? "Checking in..."
                                  : "Check In"}
                              </button>
                            )}

                            {canCancel && (
                              <button
                                type="button"
                                className="btn btn-danger !py-1.5 !px-3 text-xs"
                                onClick={() =>
                                  void cancelReservation(
                                    reservation,
                                  )
                                }
                                disabled={
                                  cancellingId !==
                                    null ||
                                  checkingInId !== null
                                }
                              >
                                {isCancelling
                                  ? "Cancelling..."
                                  : "Cancel"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* RESERVATION DETAILS MODAL                                          */}
      {/* ================================================================== */}

      {selectedReservation && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reservation-details-title"
        >
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase text-indigo-600 font-semibold">
                  Reservation Details
                </div>

                <h2
                  id="reservation-details-title"
                  className="text-2xl font-bold text-slate-900 mt-1"
                >
                  #
                  {
                    selectedReservation.id
                  }
                </h2>
              </div>

              <button
                type="button"
                className="text-slate-400 hover:text-slate-700 text-2xl"
                onClick={
                  closeReservation
                }
                disabled={
                  cancellingId !== null ||
                  checkingInId !== null
                }
                aria-label="Close reservation details"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              <DetailRow
                label="Room"
                value={
                  selectedReservation.roomName ||
                  "-"
                }
              />

              <DetailRow
                label="Customer"
                value={
                  selectedReservation.customerName ||
                  "Unknown customer"
                }
              />

              <DetailRow
                label="Phone"
                value={
                  selectedReservation.customerPhone ||
                  "-"
                }
              />

              <DetailRow
                label="Start"
                value={formatDateTime(
                  selectedReservation.startAt,
                )}
              />

              <DetailRow
                label="End"
                value={formatDateTime(
                  selectedReservation.endAt,
                )}
              />

              <DetailRow
                label="Duration"
                value={
                  calculateDuration(
                    selectedReservation.startAt,
                    selectedReservation.endAt,
                  ) !== null
                    ? `${calculateDuration(
                        selectedReservation.startAt,
                        selectedReservation.endAt,
                      )} hour(s)`
                    : "-"
                }
              />

              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-slate-500">
                  Status
                </span>

                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${getReservationStatusClass(
                    selectedReservation.status,
                  )}`}
                >
                  {getReservationStatusLabel(
                    selectedReservation.status,
                  )}
                </span>
              </div>

              {selectedReservation.notes?.trim() && (
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                  <div className="text-xs uppercase font-semibold text-slate-500 mb-1">
                    Notes
                  </div>

                  <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                    {
                      selectedReservation.notes
                    }
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-slate-100 flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={
                  closeReservation
                }
                disabled={
                  cancellingId !==
                  null
                }
              >
                Close
              </button>

              {selectedReservation.status === "confirmed" &&
                (safeDate(selectedReservation.startAt)?.getTime() ?? Infinity) <= Date.now() && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void checkInReservation(selectedReservation)
                  }
                  disabled={
                    checkingInId !== null ||
                    cancellingId !== null
                  }
                >
                  {checkingInId === selectedReservation.id
                    ? "Checking in..."
                    : "Check In"}
                </button>
              )}

              {selectedReservation.status ===
                "confirmed" && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() =>
                    void cancelReservation(
                      selectedReservation,
                    )
                  }
                  disabled={
                    cancellingId !== null ||
                    checkingInId !== null
                  }
                >
                  {cancellingId ===
                  selectedReservation.id
                    ? "Cancelling..."
                    : "Cancel reservation"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * TIME GRID
 * ========================================================================== */

function TimeGrid({
  days,
  reservations,
  onSelectReservation,
}: {
  days: Date[];
  reservations: Reservation[];
  onSelectReservation: (
    reservation: Reservation,
  ) => void;
}) {
  const hours = Array.from(
    {
      length: 15,
    },
    (_, index) =>
      index + 8,
  );

  return (
    <div className="card overflow-hidden">
      <div
        className="overflow-auto"
        style={{
          maxHeight:
            "calc(100vh - 260px)",
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

          {days.map(
            (day) => (
              <div
                key={day.toISOString()}
                className="sticky top-0 z-20 bg-white border-b border-slate-200 p-3 text-center"
              >
                <div className="text-xs uppercase text-slate-400 font-semibold">
                  {day.toLocaleDateString(
                    "en-US",
                    {
                      weekday:
                        "short",
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
                      month:
                        "short",
                    },
                  )}
                </div>
              </div>
            ),
          )}

          {/* HOURS */}
          {hours.map(
            (hour) => (
              <div
                key={`row-${hour}`}
                className="contents"
              >
                <div className="border-r border-b border-slate-100 bg-slate-50 p-2 text-xs text-slate-400 text-right">
                  {formatHour(hour)}
                </div>

                {days.map(
                  (day) => {
                    const cellStart =
                      new Date(
                        day,
                      );

                    cellStart.setHours(
                      hour,
                      0,
                      0,
                      0,
                    );

                    const cellEnd =
                      new Date(
                        day,
                      );

                    cellEnd.setHours(
                      hour + 1,
                      0,
                      0,
                      0,
                    );

                    const startingEvents =
                      reservations.filter(
                        (
                          reservation,
                        ) => {
                          const start =
                            safeDate(
                              reservation.startAt,
                            );

                          if (!start) {
                            return false;
                          }

                          return (
                            sameDay(
                              start,
                              day,
                            ) &&
                            start >=
                              cellStart &&
                            start <
                              cellEnd
                          );
                        },
                      );

                    const spanningEvents =
                      hour === 8
                        ? reservations.filter(
                            (
                              reservation,
                            ) => {
                              const start =
                                safeDate(
                                  reservation.startAt,
                                );

                              const end =
                                safeDate(
                                  reservation.endAt,
                                );

                              if (
                                !start ||
                                !end
                              ) {
                                return false;
                              }

                              return (
                                start <
                                  cellStart &&
                                end >
                                  cellStart &&
                                sameDay(
                                  end,
                                  day,
                                )
                              );
                            },
                          )
                        : [];

                    const events =
                      uniqueReservations(
                        [
                          ...startingEvents,
                          ...spanningEvents,
                        ],
                      );

                    return (
                      <div
                        key={`${day.toISOString()}-${hour}`}
                        className="relative min-h-[76px] border-b border-slate-100 bg-white p-1"
                      >
                        <div className="absolute inset-x-0 top-1/2 border-t border-slate-50" />

                        <div className="relative space-y-1">
                          {events.map(
                            (
                              event,
                            ) => (
                              <ReservationCard
                                key={
                                  event.id
                                }
                                reservation={
                                  event
                                }
                                onSelect={() =>
                                  onSelectReservation(
                                    event,
                                  )
                                }
                              />
                            ),
                          )}
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * MONTH VIEW
 * ========================================================================== */

function MonthView({
  currentDate,
  reservations,
  onSelectReservation,
}: {
  currentDate: Date;
  reservations: Reservation[];
  onSelectReservation: (
    reservation: Reservation,
  ) => void;
}) {
  const days =
    getMonthGridDays(
      currentDate,
    );

  return (
    <div className="card overflow-hidden">
      {/* WEEK DAYS */}
      <div className="grid grid-cols-7 border-b border-slate-200">
        {[
          "Sun",
          "Mon",
          "Tue",
          "Wed",
          "Thu",
          "Fri",
          "Sat",
        ].map(
          (day) => (
            <div
              key={day}
              className="p-3 text-center text-xs font-bold uppercase text-slate-400 border-r border-slate-100 last:border-r-0"
            >
              {day}
            </div>
          ),
        )}
      </div>

      {/* DAYS */}
      <div className="grid grid-cols-7">
        {days.map(
          (day) => {
            const events =
              reservations
                .filter(
                  (
                    reservation,
                  ) =>
                    reservationOverlapsDay(
                      reservation,
                      day,
                    ),
                )
                .sort(
                  (
                    first,
                    second,
                  ) =>
                    (safeDate(
                      first.startAt,
                    )?.getTime() ??
                      0) -
                    (safeDate(
                      second.startAt,
                    )?.getTime() ??
                      0),
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
                    (
                      event,
                    ) => (
                      <ReservationCard
                        key={
                          event.id
                        }
                        reservation={
                          event
                        }
                        compact
                        onSelect={() =>
                          onSelectReservation(
                            event,
                          )
                        }
                      />
                    ),
                  )}
                </div>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * RESERVATION CARD
 * ========================================================================== */

function ReservationCard({
  reservation,
  compact = false,
  onSelect,
}: {
  reservation: Reservation;
  compact?: boolean;
  onSelect: () => void;
}) {
  const statusLabel =
    getReservationStatusLabel(
      reservation.status,
    );

  const statusClass =
    getReservationStatusClass(
      reservation.status,
    );

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg border border-indigo-100 bg-indigo-50 hover:bg-indigo-100 transition ${
        compact
          ? "p-2"
          : "p-2.5"
      }`}
      title="View reservation details"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-bold text-indigo-700 truncate min-w-0">
          {reservation.roomName ||
            "Meeting Room"}
        </div>

        <span
          className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusClass}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="text-xs font-semibold text-slate-800 truncate mt-0.5">
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
            <div className="text-[11px] text-slate-500 truncate">
              📞{" "}
              {
                reservation.customerPhone
              }
            </div>
          )}

          {reservation.notes?.trim() && (
            <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">
              📝{" "}
              {
                reservation.notes
              }
            </div>
          )}
        </>
      )}
    </button>
  );
}

/* ============================================================================
 * DETAILS ROW
 * ========================================================================== */

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-slate-500">
        {label}
      </span>

      <span className="text-sm font-semibold text-slate-900 text-right break-words">
        {value}
      </span>
    </div>
  );
}

/* ============================================================================
 * DATE HELPERS
 * ========================================================================== */

function getVisibleDays(
  date: Date,
  view: ViewMode,
): Date[] {
  if (
    view === "day"
  ) {
    return [
      startOfDay(date),
    ];
  }

  const start =
    startOfWeek(date);

  return Array.from(
    {
      length: 7,
    },
    (_, index) => {
      const day =
        new Date(start);

      day.setDate(
        day.getDate() +
          index,
      );

      return day;
    },
  );
}

function getMonthGridDays(
  date: Date,
): Date[] {
  const first =
    new Date(
      date.getFullYear(),
      date.getMonth(),
      1,
    );

  const start =
    startOfWeek(first);

  return Array.from(
    {
      length: 42,
    },
    (_, index) => {
      const day =
        new Date(start);

      day.setDate(
        day.getDate() +
          index,
      );

      return day;
    },
  );
}

function startOfDay(
  date: Date,
): Date {
  const result =
    new Date(date);

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
): Date {
  const result =
    startOfDay(date);

  const day =
    result.getDay();

  result.setDate(
    result.getDate() -
      day,
  );

  return result;
}

function moveCalendarDate(
  currentDate: Date,
  view: ViewMode,
  direction: number,
): Date {
  const result =
    new Date(
      currentDate,
    );

  if (
    view === "day"
  ) {
    result.setDate(
      result.getDate() +
        direction,
    );

    return result;
  }

  if (
    view === "week"
  ) {
    result.setDate(
      result.getDate() +
        direction * 7,
    );

    return result;
  }

  result.setDate(1);

  result.setMonth(
    result.getMonth() +
      direction,
  );

  return result;
}

/* ============================================================================
 * RESERVATION HELPERS
 * ========================================================================== */

function reservationOverlapsDay(
  reservation: Reservation,
  day: Date,
): boolean {
  const dayStart =
    startOfDay(day);

  const dayEnd =
    new Date(dayStart);

  dayEnd.setDate(
    dayEnd.getDate() + 1,
  );

  const reservationStart =
    safeDate(
      reservation.startAt,
    );

  const reservationEnd =
    safeDate(
      reservation.endAt,
    );

  if (
    !reservationStart ||
    !reservationEnd
  ) {
    return false;
  }

  return (
    reservationStart <
      dayEnd &&
    reservationEnd >
      dayStart
  );
}

/* ============================================================================
 * DISPLAY HELPERS
 * ========================================================================== */

function formatHour(
  hour: number,
): string {
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
): string {
  if (
    view === "day"
  ) {
    return date.toLocaleDateString(
      "en-US",
      {
        weekday:
          "long",
        month:
          "long",
        day: "numeric",
        year:
          "numeric",
      },
    );
  }

  if (
    view === "month"
  ) {
    return date.toLocaleDateString(
      "en-US",
      {
        month:
          "long",
        year:
          "numeric",
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
      month:
        "short",
      day:
        "numeric",
    },
  )} – ${end.toLocaleDateString(
    "en-US",
    {
      month:
        "short",
      day:
        "numeric",
      year:
        "numeric",
    },
  )}`;
}