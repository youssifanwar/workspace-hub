"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

/* ============================================================================
 * TYPES
 * ========================================================================== */

type DeskType =
  | "desk"
  | "meeting_room";

type PricingTier = {
  id: number;

  minPeople: number;

  maxPeople: number;

  hourlyRate: string;

  active: boolean;
};

type D = {
  id: number;

  name: string;

  type: DeskType;

  /**
   * Legacy physical-location rate.
   *
   * IMPORTANT:
   * This is NOT used for Customer Session billing.
   *
   * Meeting rooms use pricingTiers.
   */
  hourlyRate: string;

  capacity: number;

  active: boolean;

  sortOrder: number;

  pricingTiers: PricingTier[];
};

type EditingRoom = {
  name: string;

  capacity: string;

  sortOrder: string;

  tiers: Array<{
    id?: number;

    minPeople: string;

    maxPeople: string;

    hourlyRate: string;

    active: boolean;
  }>;
};

type EditingDesk = {
  name: string;

  sortOrder: string;
};

/* ============================================================================
 * MAIN COMPONENT
 * ========================================================================== */

export default function DesksAdmin({
  desks,
  currency,
}: {
  desks: D[];

  currency: string;
}) {
  const router =
    useRouter();

  const [
    adding,
    setAdding,
  ] = useState(false);

  const [
    editingDesk,
    setEditingDesk,
  ] =
    useState<
      Record<
        number,
        EditingDesk
      >
    >({});

  const [
    editingRoom,
    setEditingRoom,
  ] =
    useState<
      Record<
        number,
        EditingRoom
      >
    >({});

  const [
    loadingId,
    setLoadingId,
  ] =
    useState<
      number | null
    >(null);

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  const [
    success,
    setSuccess,
  ] =
    useState<
      string | null
    >(null);

  /* ------------------------------------------------------------------------ */
  /* HELPERS                                                                  */
  /* ------------------------------------------------------------------------ */

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  /* ------------------------------------------------------------------------ */
  /* START DESK EDIT                                                          */
  /* ------------------------------------------------------------------------ */

  function startDeskEdit(
    desk: D,
  ) {
    clearMessages();

    setEditingDesk(
      (current) => ({
        ...current,

        [desk.id]: {
          name:
            desk.name,

          sortOrder:
            String(
              desk.sortOrder,
            ),
        },
      }),
    );
  }

  /* ------------------------------------------------------------------------ */
  /* START ROOM EDIT                                                          */
  /* ------------------------------------------------------------------------ */

  function startRoomEdit(
    room: D,
  ) {
    clearMessages();

    setEditingRoom(
      (current) => ({
        ...current,

        [room.id]: {
          name:
            room.name,

          capacity:
            String(
              room.capacity,
            ),

          sortOrder:
            String(
              room.sortOrder,
            ),

          tiers:
            room.pricingTiers.map(
              (tier) => ({
                id:
                  tier.id,

                minPeople:
                  String(
                    tier.minPeople,
                  ),

                maxPeople:
                  String(
                    tier.maxPeople,
                  ),

                hourlyRate:
                  String(
                    tier.hourlyRate,
                  ),

                active:
                  tier.active,
              }),
            ),
        },
      }),
    );
  }

  /* ------------------------------------------------------------------------ */
  /* VALIDATE TIERS                                                           */
  /* ------------------------------------------------------------------------ */

  function validateRoomTiers(
    room: D,
    edit: EditingRoom,
  ): string | null {
    const capacity =
      Number(
        edit.capacity,
      );

    if (
      !Number.isInteger(
        capacity,
      ) ||
      capacity <= 0
    ) {
      return "Room capacity must be a positive whole number.";
    }

    if (
      edit.tiers.length ===
      0
    ) {
      return "A meeting room must have at least one pricing tier.";
    }

    const tiers =
      edit.tiers
        .map(
          (tier) => ({
            minPeople:
              Number(
                tier.minPeople,
              ),

            maxPeople:
              Number(
                tier.maxPeople,
              ),

            hourlyRate:
              Number(
                tier.hourlyRate,
              ),

            active:
              tier.active,
          }),
        )
        .filter(
          (tier) =>
            tier.active,
        )
        .sort(
          (
            a,
            b,
          ) =>
            a.minPeople -
            b.minPeople,
        );

    if (
      tiers.length ===
      0
    ) {
      return "At least one active pricing tier is required.";
    }

    let expectedMin =
      1;

    for (
      const tier of tiers
    ) {
      if (
        !Number.isInteger(
          tier.minPeople,
        ) ||
        !Number.isInteger(
          tier.maxPeople,
        )
      ) {
        return "People ranges must use whole numbers.";
      }

      if (
        tier.minPeople <=
          0 ||
        tier.maxPeople <
          tier.minPeople
      ) {
        return "Invalid people range.";
      }

      if (
        tier.minPeople !==
        expectedMin
      ) {
        return "Pricing ranges must start at 1 and continue without gaps or overlaps.";
      }

      if (
        tier.maxPeople >
        capacity
      ) {
        return `A pricing tier cannot exceed the room capacity of ${capacity}.`;
      }

      if (
        !Number.isFinite(
          tier.hourlyRate,
        ) ||
        tier.hourlyRate <=
          0
      ) {
        return "Every active pricing tier must have a rate greater than zero.";
      }

      expectedMin =
        tier.maxPeople +
        1;
    }

    if (
      expectedMin !==
      capacity + 1
    ) {
      return `Pricing tiers must cover all attendee counts from 1 to ${capacity}.`;
    }

    return null;
  }

  /* ------------------------------------------------------------------------ */
  /* SAVE DESK                                                                */
  /* ------------------------------------------------------------------------ */

  async function saveDesk(
    desk: D,
  ) {
    const edit =
      editingDesk[
        desk.id
      ];

    if (!edit) {
      return;
    }

    clearMessages();

    const name =
      edit.name.trim();

    const sortOrder =
      Number(
        edit.sortOrder,
      );

    if (
      name.length <
      1
    ) {
      setError(
        "Desk name is required.",
      );

      return;
    }

    if (
      !Number.isInteger(
        sortOrder,
      )
    ) {
      setError(
        "Sort order must be a whole number.",
      );

      return;
    }

    setLoadingId(
      desk.id,
    );

    try {
      const response =
        await fetch(
          `/api/desks/${desk.id}`,
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                name,

                sortOrder,
              }),
          },
        );

      const data =
        await response
          .json()
          .catch(
            () => ({}),
          );

      if (
        !response.ok
      ) {
        setError(
          data.error ||
            `Could not save desk (HTTP ${response.status}).`,
        );

        return;
      }

      setEditingDesk(
        (current) => {
          const next =
            {
              ...current,
            };

          delete next[
            desk.id
          ];

          return next;
        },
      );

      setSuccess(
        `"${name}" updated successfully.`,
      );

      router.refresh();
    } catch (requestError) {
      console.error(
        "Save desk error:",
        requestError,
      );

      setError(
        "Could not connect to the server.",
      );
    } finally {
      setLoadingId(
        null,
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* SAVE ROOM                                                                 */
  /* ------------------------------------------------------------------------ */

  async function saveRoom(
    room: D,
  ) {
    const edit =
      editingRoom[
        room.id
      ];

    if (!edit) {
      return;
    }

    clearMessages();

    const validation =
      validateRoomTiers(
        room,
        edit,
      );

    if (validation) {
      setError(
        validation,
      );

      return;
    }

    const name =
      edit.name.trim();

    const capacity =
      Number(
        edit.capacity,
      );

    const sortOrder =
      Number(
        edit.sortOrder,
      );

    if (
      !name
    ) {
      setError(
        "Room name is required.",
      );

      return;
    }

    if (
      !Number.isInteger(
        sortOrder,
      )
    ) {
      setError(
        "Sort order must be a whole number.",
      );

      return;
    }

    setLoadingId(
      room.id,
    );

    try {
      /* --------------------------------------------------------------------
       * SAVE ROOM + PRICING ATOMICALLY
       *
       * The API receives the room settings and all pricing tiers together.
       * The backend transaction is responsible for updating both parts as
       * one atomic operation.
       * ------------------------------------------------------------------ */

      const response =
        await fetch(
          `/api/desks/${room.id}`,
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                name,

                capacity,

                sortOrder,

                meetingPricing:
                  edit.tiers.map(
                    (
                      tier,
                    ) => ({
                      id:
                        tier.id,

                      minPeople:
                        Number(
                          tier.minPeople,
                        ),

                      maxPeople:
                        Number(
                          tier.maxPeople,
                        ),

                      hourlyRate:
                        Number(
                          tier.hourlyRate,
                        ),

                      active:
                        tier.active,
                    }),
                  ),
              }),
          },
        );

      const data =
        await response
          .json()
          .catch(
            () => ({}),
          );

      if (
        !response.ok
      ) {
        setError(
          data.error ||
            `Could not save room (HTTP ${response.status}).`,
        );

        return;
      }

      setEditingRoom(
        (current) => {
          const next =
            {
              ...current,
            };

          delete next[
            room.id
          ];

          return next;
        },
      );

      setSuccess(
        `"${name}" and its pricing were updated successfully.`,
      );

      router.refresh();
    } catch (requestError) {
      console.error(
        "Save meeting room error:",
        requestError,
      );

      setError(
        "Could not connect to the server.",
      );
    } finally {
      setLoadingId(
        null,
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* TOGGLE ACTIVE                                                            */
  /* ------------------------------------------------------------------------ */

  async function toggleActive(
    desk: D,
  ) {
    clearMessages();

    const action =
      desk.active
        ? "deactivate"
        : "activate";

    const confirmed =
      window.confirm(
        desk.active
          ? `Deactivate "${desk.name}"? Existing historical reservations will remain untouched.`
          : `Activate "${desk.name}"?`,
      );

    if (!confirmed) {
      return;
    }

    setLoadingId(
      desk.id,
    );

    try {
      const response =
        await fetch(
          `/api/desks/${desk.id}`,
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                active:
                  !desk.active,
              }),
          },
        );

      const data =
        await response
          .json()
          .catch(
            () => ({}),
          );

      if (
        !response.ok
      ) {
        setError(
          data.error ||
            `Could not ${action} "${desk.name}" (HTTP ${response.status}).`,
        );

        return;
      }

      setSuccess(
        `"${desk.name}" ${
          desk.active
            ? "deactivated"
            : "activated"
        } successfully.`,
      );

      router.refresh();
    } catch (requestError) {
      console.error(
        "Toggle location error:",
        requestError,
      );

      setError(
        "Could not connect to the server.",
      );
    } finally {
      setLoadingId(
        null,
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* ADD                                                                        */
  /* ------------------------------------------------------------------------ */

  function handleSaved() {
    setAdding(
      false,
    );

    setSuccess(
      "Location created successfully.",
    );

    router.refresh();
  }

  /* ------------------------------------------------------------------------ */
  /* RENDER                                                                    */
  /* ------------------------------------------------------------------------ */

  return (
    <>
      {/* -------------------------------------------------------------------- */}
      {/* HEADER                                                               */}
      {/* -------------------------------------------------------------------- */}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="font-semibold text-slate-900">
            Physical locations
          </div>

          <div className="text-xs text-slate-500 mt-1">
            Desks are physical locations.
            Customer-session pricing is
            managed separately. Meeting
            rooms have their own attendee
            pricing.
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setAdding(true)
          }
          className="btn btn-primary"
        >
          + Add location
        </button>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* MESSAGES                                                             */}
      {/* -------------------------------------------------------------------- */}

      {error && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          {success}
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* TABLE                                                                */}
      {/* -------------------------------------------------------------------- */}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase text-left">
            <tr>
              <th className="py-3 pr-4">
                Name
              </th>

              <th className="py-3 pr-4">
                Type
              </th>

              <th className="py-3 pr-4">
                Capacity
              </th>

              <th className="py-3 pr-4">
                Pricing
              </th>

              <th className="py-3 pr-4">
                Order
              </th>

              <th className="py-3 pr-4">
                Status
              </th>

              <th className="py-3 text-right">
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {desks.map(
              (desk) => {
                const deskEdit =
                  editingDesk[
                    desk.id
                  ];

                const roomEdit =
                  editingRoom[
                    desk.id
                  ];

                const loading =
                  loadingId ===
                  desk.id;

                return (
                  <tr
                    key={
                      desk.id
                    }
                    className="border-t border-slate-100 align-top"
                  >
                    {/* ---------------------------------------------------- */}
                    {/* NAME                                                 */}
                    {/* ---------------------------------------------------- */}

                    <td className="py-4 pr-4 min-w-52">
                      {desk.type ===
                      "meeting_room" ? (
                        roomEdit ? (
                          <input
                            className="input !py-1 w-full"
                            value={
                              roomEdit.name
                            }
                            onChange={(
                              event,
                            ) =>
                              setEditingRoom(
                                (
                                  current,
                                ) => ({
                                  ...current,

                                  [desk.id]:
                                    {
                                      ...roomEdit,

                                      name:
                                        event
                                          .target
                                          .value,
                                    },
                                }),
                              )
                            }
                          />
                        ) : (
                          <span className="font-semibold">
                            {
                              desk.name
                            }
                          </span>
                        )
                      ) : deskEdit ? (
                        <input
                          className="input !py-1 w-full"
                          value={
                            deskEdit.name
                          }
                          onChange={(
                            event,
                          ) =>
                            setEditingDesk(
                              (
                                current,
                              ) => ({
                                ...current,

                                [desk.id]:
                                  {
                                    ...deskEdit,

                                    name:
                                      event
                                        .target
                                        .value,
                                  },
                              }),
                            )
                          }
                        />
                      ) : (
                        <span className="font-semibold">
                          {
                            desk.name
                          }
                        </span>
                      )}
                    </td>

                    {/* ---------------------------------------------------- */}
                    {/* TYPE                                                 */}
                    {/* ---------------------------------------------------- */}

                    <td className="py-4 pr-4">
                      <span
                        className={`badge ${
                          desk.type ===
                          "meeting_room"
                            ? "badge-amber"
                            : "badge-blue"
                        }`}
                      >
                        {desk.type ===
                        "meeting_room"
                          ? "Room"
                          : "Desk"}
                      </span>
                    </td>

                    {/* ---------------------------------------------------- */}
                    {/* CAPACITY                                             */}
                    {/* ---------------------------------------------------- */}

                    <td className="py-4 pr-4 min-w-32">
                      {desk.type ===
                      "meeting_room" ? (
                        roomEdit ? (
                          <input
                            type="number"
                            min={1}
                            step={1}
                            className="input !py-1 w-24"
                            value={
                              roomEdit.capacity
                            }
                            onChange={(
                              event,
                            ) =>
                              setEditingRoom(
                                (
                                  current,
                                ) => ({
                                  ...current,

                                  [desk.id]:
                                    {
                                      ...roomEdit,

                                      capacity:
                                        event
                                          .target
                                          .value,
                                    },
                                }),
                              )
                            }
                          />
                        ) : (
                          <span>
                            {
                              desk.capacity
                            }{" "}
                            people
                          </span>
                        )
                      ) : (
                        <span className="text-slate-400">
                          —
                        </span>
                      )}
                    </td>

                    {/* ---------------------------------------------------- */}
                    {/* PRICING                                              */}
                    {/* ---------------------------------------------------- */}

                    <td className="py-4 pr-4 min-w-72">
                      {desk.type ===
                      "meeting_room" ? (
                        roomEdit ? (
                          <div className="space-y-2">
                            {roomEdit.tiers.map(
                              (
                                tier,
                                index,
                              ) => (
                                <div
                                  key={
                                    tier.id ??
                                    `new-${index}`
                                  }
                                  className="grid grid-cols-[70px_70px_1fr_auto] gap-2 items-center"
                                >
                                  <input
                                    type="number"
                                    min={1}
                                    step={1}
                                    className="input !py-1"
                                    value={
                                      tier.minPeople
                                    }
                                    onChange={(
                                      event,
                                    ) =>
                                      setEditingRoom(
                                        (
                                          current,
                                        ) => ({
                                          ...current,

                                          [desk.id]:
                                            {
                                              ...roomEdit,

                                              tiers:
                                                roomEdit.tiers.map(
                                                  (
                                                    item,
                                                    itemIndex,
                                                  ) =>
                                                    itemIndex ===
                                                    index
                                                      ? {
                                                          ...item,

                                                          minPeople:
                                                            event
                                                              .target
                                                              .value,
                                                        }
                                                      : item,
                                                ),
                                            },
                                        }),
                                      )
                                    }
                                  />

                                  <input
                                    type="number"
                                    min={1}
                                    step={1}
                                    className="input !py-1"
                                    value={
                                      tier.maxPeople
                                    }
                                    onChange={(
                                      event,
                                    ) =>
                                      setEditingRoom(
                                        (
                                          current,
                                        ) => ({
                                          ...current,

                                          [desk.id]:
                                            {
                                              ...roomEdit,

                                              tiers:
                                                roomEdit.tiers.map(
                                                  (
                                                    item,
                                                    itemIndex,
                                                  ) =>
                                                    itemIndex ===
                                                    index
                                                      ? {
                                                          ...item,

                                                          maxPeople:
                                                            event
                                                              .target
                                                              .value,
                                                        }
                                                      : item,
                                                ),
                                            },
                                        }),
                                      )
                                    }
                                  />

                                  <input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    className="input !py-1"
                                    value={
                                      tier.hourlyRate
                                    }
                                    onChange={(
                                      event,
                                    ) =>
                                      setEditingRoom(
                                        (
                                          current,
                                        ) => ({
                                          ...current,

                                          [desk.id]:
                                            {
                                              ...roomEdit,

                                              tiers:
                                                roomEdit.tiers.map(
                                                  (
                                                    item,
                                                    itemIndex,
                                                  ) =>
                                                    itemIndex ===
                                                    index
                                                      ? {
                                                          ...item,

                                                          hourlyRate:
                                                            event
                                                              .target
                                                              .value,
                                                        }
                                                      : item,
                                                ),
                                            },
                                        }),
                                      )
                                    }
                                  />

                                  <button
                                    type="button"
                                    className="btn btn-danger !py-1 !px-2"
                                    onClick={() =>
                                      setEditingRoom(
                                        (
                                          current,
                                        ) => ({
                                          ...current,

                                          [desk.id]:
                                            {
                                              ...roomEdit,

                                              tiers:
                                                roomEdit.tiers.filter(
                                                  (
                                                    _item,
                                                    itemIndex,
                                                  ) =>
                                                    itemIndex !==
                                                    index,
                                                ),
                                            },
                                        }),
                                      )
                                    }
                                  >
                                    ×
                                  </button>

                                  <div className="col-span-4 flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={
                                        tier.active
                                      }
                                      onChange={(
                                        event,
                                      ) =>
                                        setEditingRoom(
                                          (
                                            current,
                                          ) => ({
                                            ...current,

                                            [desk.id]:
                                              {
                                                ...roomEdit,

                                                tiers:
                                                  roomEdit.tiers.map(
                                                    (
                                                      item,
                                                      itemIndex,
                                                    ) =>
                                                      itemIndex ===
                                                      index
                                                        ? {
                                                            ...item,

                                                            active:
                                                              event
                                                                .target
                                                                .checked,
                                                          }
                                                        : item,
                                                  ),
                                              },
                                          }),
                                        )
                                      }
                                    />

                                    <span className="text-xs text-slate-500">
                                      Active
                                    </span>
                                  </div>
                                </div>
                              ),
                            )}

                            <button
                              type="button"
                              className="text-xs font-semibold text-indigo-600 hover:underline"
                              onClick={() =>
                                setEditingRoom(
                                  (
                                    current,
                                  ) => ({
                                    ...current,

                                    [desk.id]:
                                      {
                                        ...roomEdit,

                                        tiers:
                                          [
                                            ...roomEdit.tiers,

                                            {
                                              minPeople:
                                                "1",

                                              maxPeople:
                                                String(
                                                  Math.max(
                                                    1,
                                                    Number(
                                                      roomEdit.capacity,
                                                    ),
                                                  ),
                                                ),

                                              hourlyRate:
                                                "0",

                                              active:
                                                true,
                                            },
                                          ],
                                      },
                                  }),
                                )
                              }
                            >
                              + Add pricing tier
                            </button>
                          </div>
                        ) : desk.pricingTiers &&
                          desk.pricingTiers
                            .filter(
                              (
                                tier,
                              ) =>
                                tier.active,
                            )
                            .length >
                            0 ? (
                          <div className="space-y-1">
                            {desk.pricingTiers
                              .filter(
                                (
                                  tier,
                                ) =>
                                  tier.active,
                              )
                              .map(
                                (
                                  tier,
                                ) => (
                                  <div
                                    key={
                                      tier.id
                                    }
                                    className="flex justify-between gap-3"
                                  >
                                    <span className="text-slate-500">
                                      {
                                        tier.minPeople
                                      }
                                      –
                                      {
                                        tier.maxPeople
                                      }{" "}
                                      people
                                    </span>

                                    <span className="font-semibold">
                                      {Number(
                                        tier.hourlyRate,
                                      ).toFixed(
                                        2,
                                      )}{" "}
                                      {
                                        currency
                                      }
                                      /h
                                    </span>
                                  </div>
                                ),
                              )}
                          </div>
                        ) : (
                          <span className="text-red-500 text-xs">
                            No pricing configured
                          </span>
                        )
                      ) : (
                        <span className="text-slate-400">
                          Customer-session pricing
                        </span>
                      )}
                    </td>

                    {/* ---------------------------------------------------- */}
                    {/* ORDER                                                */}
                    {/* ---------------------------------------------------- */}

                    <td className="py-4 pr-4 min-w-24">
                      {desk.type ===
                      "meeting_room"
                        ? roomEdit
                          ? (
                              <input
                                type="number"
                                step={1}
                                className="input !py-1 w-20"
                                value={
                                  roomEdit.sortOrder
                                }
                                onChange={(
                                  event,
                                ) =>
                                  setEditingRoom(
                                    (
                                      current,
                                    ) => ({
                                      ...current,

                                      [desk.id]:
                                        {
                                          ...roomEdit,

                                          sortOrder:
                                            event
                                              .target
                                              .value,
                                        },
                                    }),
                                  )
                                }
                              />
                            )
                          : desk.sortOrder
                        : deskEdit
                          ? (
                              <input
                                type="number"
                                step={1}
                                className="input !py-1 w-20"
                                value={
                                  deskEdit.sortOrder
                                }
                                onChange={(
                                  event,
                                ) =>
                                  setEditingDesk(
                                    (
                                      current,
                                    ) => ({
                                      ...current,

                                      [desk.id]:
                                        {
                                          ...deskEdit,

                                          sortOrder:
                                            event
                                              .target
                                              .value,
                                        },
                                    }),
                                  )
                                }
                              />
                            )
                          : desk.sortOrder}
                    </td>

                    {/* ---------------------------------------------------- */}
                    {/* STATUS                                               */}
                    {/* ---------------------------------------------------- */}

                    <td className="py-4 pr-4">
                      <span
                        className={`badge ${
                          desk.active
                            ? "badge-green"
                            : "badge-red"
                        }`}
                      >
                        {desk.active
                          ? "Active"
                          : "Inactive"}
                      </span>
                    </td>

                    {/* ---------------------------------------------------- */}
                    {/* ACTIONS                                               */}
                    {/* ---------------------------------------------------- */}

                    <td className="py-4 text-right">
                      {desk.type ===
                      "meeting_room" ? (
                        roomEdit ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className="btn btn-success !py-1 !px-2 text-xs"
                              onClick={() =>
                                saveRoom(
                                  desk,
                                )
                              }
                              disabled={
                                loading
                              }
                            >
                              {loading
                                ? "Saving..."
                                : "Save"}
                            </button>

                            <button
                              type="button"
                              className="btn btn-ghost !py-1 !px-2 text-xs"
                              onClick={() =>
                                setEditingRoom(
                                  (
                                    current,
                                  ) => {
                                    const next =
                                      {
                                        ...current,
                                      };

                                    delete next[
                                      desk.id
                                    ];

                                    return next;
                                  },
                                )
                              }
                              disabled={
                                loading
                              }
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className="btn btn-ghost !py-1 !px-2 text-xs"
                              onClick={() =>
                                startRoomEdit(
                                  desk,
                                )
                              }
                            >
                              ✏️ Edit room
                            </button>

                            <button
                              type="button"
                              className="btn btn-ghost !py-1 !px-2 text-xs"
                              onClick={() =>
                                toggleActive(
                                  desk,
                                )
                              }
                              disabled={
                                loading
                              }
                            >
                              {desk.active
                                ? "Deactivate"
                                : "Activate"}
                            </button>
                          </div>
                        )
                      ) : deskEdit ? (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="btn btn-success !py-1 !px-2 text-xs"
                            onClick={() =>
                              saveDesk(
                                desk,
                              )
                            }
                            disabled={
                              loading
                            }
                          >
                            {loading
                              ? "Saving..."
                              : "Save"}
                          </button>

                          <button
                            type="button"
                            className="btn btn-ghost !py-1 !px-2 text-xs"
                            onClick={() =>
                              setEditingDesk(
                                (
                                  current,
                                ) => {
                                  const next =
                                    {
                                      ...current,
                                    };

                                  delete next[
                                    desk.id
                                  ];

                                  return next;
                                },
                              )
                            }
                            disabled={
                              loading
                            }
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="btn btn-ghost !py-1 !px-2 text-xs"
                            onClick={() =>
                              startDeskEdit(
                                desk,
                              )
                            }
                          >
                            ✏️ Edit
                          </button>

                          <button
                            type="button"
                            className="btn btn-ghost !py-1 !px-2 text-xs"
                            onClick={() =>
                              toggleActive(
                                desk,
                              )
                            }
                            disabled={
                              loading
                            }
                          >
                            {desk.active
                              ? "Deactivate"
                              : "Activate"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* ADD MODAL                                                            */}
      {/* -------------------------------------------------------------------- */}

      {adding && (
        <AddLocationModal
          currency={
            currency
          }
          onClose={() =>
            setAdding(false)
          }
          onSaved={
            handleSaved
          }
        />
      )}
    </>
  );
}

/* ============================================================================
 * ADD LOCATION MODAL
 * ========================================================================== */

function AddLocationModal({
  currency,
  onClose,
  onSaved,
}: {
  currency: string;

  onClose: () => void;

  onSaved: () => void;
}) {
  const [
    name,
    setName,
  ] = useState("");

  const [
    type,
    setType,
  ] =
    useState<DeskType>(
      "desk",
    );

  const [
    capacity,
    setCapacity,
  ] =
    useState("4");

  const [
    sortOrder,
    setSortOrder,
  ] =
    useState("0");

  const [
    hourlyRate,
    setHourlyRate,
  ] =
    useState("0");

  const [
    tiers,
    setTiers,
  ] = useState<
    Array<{
      minPeople: string;
      maxPeople: string;
      hourlyRate: string;
    }>
  >([
    {
      minPeople:
        "1",

      maxPeople:
        "2",

      hourlyRate:
        "100",
    },
  ]);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  function validate(): string | null {
    if (
      !name.trim()
    ) {
      return "Name is required.";
    }

    const order =
      Number(
        sortOrder,
      );

    if (
      !Number.isInteger(
        order,
      )
    ) {
      return "Sort order must be a whole number.";
    }

    if (
      type ===
      "desk"
    ) {
      const rate =
        Number(
          hourlyRate,
        );

      if (
        !Number.isFinite(
          rate,
        ) ||
        rate <=
          0
      ) {
        return "Desk hourly rate must be greater than zero.";
      }

      return null;
    }

    const roomCapacity =
      Number(
        capacity,
      );

    if (
      !Number.isInteger(
        roomCapacity,
      ) ||
      roomCapacity <=
        0
    ) {
      return "Room capacity must be a positive whole number.";
    }

    const normalizedTiers =
      tiers
        .map(
          (tier) => ({
            minPeople:
              Number(
                tier.minPeople,
              ),

            maxPeople:
              Number(
                tier.maxPeople,
              ),

            hourlyRate:
              Number(
                tier.hourlyRate,
              ),
          }),
        )
        .sort(
          (
            a,
            b,
          ) =>
            a.minPeople -
            b.minPeople,
        );

    if (
      normalizedTiers.length ===
      0
    ) {
      return "At least one pricing tier is required.";
    }

    let expectedMin =
      1;

    for (
      const tier of normalizedTiers
    ) {
      if (
        !Number.isInteger(
          tier.minPeople,
        ) ||
        !Number.isInteger(
          tier.maxPeople,
        )
      ) {
        return "People ranges must use whole numbers.";
      }

      if (
        tier.minPeople !==
        expectedMin
      ) {
        return "Pricing tiers must cover every attendee count without gaps or overlaps.";
      }

      if (
        tier.maxPeople <
        tier.minPeople
      ) {
        return "Invalid pricing range.";
      }

      if (
        tier.maxPeople >
        roomCapacity
      ) {
        return `Pricing cannot exceed room capacity of ${roomCapacity}.`;
      }

      if (
        !Number.isFinite(
          tier.hourlyRate,
        ) ||
        tier.hourlyRate <=
          0
      ) {
        return "Every pricing tier must have a rate greater than zero.";
      }

      expectedMin =
        tier.maxPeople +
        1;
    }

    if (
      expectedMin !==
      roomCapacity + 1
    ) {
      return `Pricing tiers must cover all people from 1 to ${roomCapacity}.`;
    }

    return null;
  }

  async function submit(
    event: React.FormEvent,
  ) {
    event.preventDefault();

    setError(null);

    const validation =
      validate();

    if (validation) {
      setError(
        validation,
      );

      return;
    }

    setLoading(true);

    try {
      /* --------------------------------------------------------------------
       * CREATE LOCATION + PRICING ATOMICALLY
       *
       * The API receives the room and its pricing tiers in the same request.
       * The backend transaction creates both together, so we do not leave a
       * room behind when pricing creation fails.
       * ------------------------------------------------------------------ */

      const response =
        await fetch(
          "/api/desks",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                name:
                  name.trim(),

                type,

                hourlyRate:
                  type ===
                  "desk"
                    ? Number(
                        hourlyRate,
                      )
                    : 0,

                capacity:
                  type ===
                  "meeting_room"
                    ? Number(
                        capacity,
                      )
                    : 1,

                sortOrder:
                  Number(
                    sortOrder,
                  ),

                tiers:
                  type ===
                  "meeting_room"
                    ? tiers.map(
                        (
                          tier,
                        ) => ({
                          minPeople:
                            Number(
                              tier.minPeople,
                            ),

                          maxPeople:
                            Number(
                              tier.maxPeople,
                            ),

                          hourlyRate:
                            Number(
                              tier.hourlyRate,
                            ),

                          active:
                            true,
                        }),
                      )
                    : undefined,
              }),
          },
        );

      const data =
        await response
          .json()
          .catch(
            () => ({}),
          );

      if (
        !response.ok
      ) {
        setError(
          data.error ||
            `Could not create location (HTTP ${response.status}).`,
        );

        return;
      }

      onSaved();
    } catch (requestError) {
      console.error(
        "Create location error:",
        requestError,
      );

      setError(
        "Could not connect to the server.",
      );
    } finally {
      setLoading(
        false,
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
      <div className="card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="text-xl font-bold">
              Add location
            </h3>

            <p className="text-sm text-slate-500 mt-1">
              Add a physical desk or
              meeting room.
            </p>
          </div>

          <button
            type="button"
            onClick={
              onClose
            }
            className="text-slate-400 hover:text-slate-700 text-2xl"
            disabled={
              loading
            }
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form
          onSubmit={
            submit
          }
          className="space-y-4"
        >
          <div>
            <label className="label">
              Name
            </label>

            <input
              className="input"
              value={
                name
              }
              onChange={(
                event,
              ) =>
                setName(
                  event
                    .target
                    .value,
                )
              }
              required
              autoFocus
              disabled={
                loading
              }
            />
          </div>

          <div>
            <label className="label">
              Type
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  setType(
                    "desk",
                  )
                }
                disabled={
                  loading
                }
                className={`p-3 rounded-xl border font-semibold text-sm ${
                  type ===
                  "desk"
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-slate-200"
                }`}
              >
                🪑 Desk
              </button>

              <button
                type="button"
                onClick={() =>
                  setType(
                    "meeting_room",
                  )
                }
                disabled={
                  loading
                }
                className={`p-3 rounded-xl border font-semibold text-sm ${
                  type ===
                  "meeting_room"
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-slate-200"
                }`}
              >
                👥 Meeting Room
              </button>
            </div>
          </div>

          {type ===
          "desk" ? (
            <div>
              <label className="label">
                Physical location rate (
                {
                  currency
                }
                )
              </label>

              <input
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                value={
                  hourlyRate
                }
                onChange={(
                  event,
                ) =>
                  setHourlyRate(
                    event
                      .target
                      .value,
                  )
                }
                required
                disabled={
                  loading
                }
              />

              <div className="text-xs text-slate-500 mt-1">
                This does not control
                Customer Session billing.
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="label">
                  Room capacity
                </label>

                <input
                  className="input"
                  type="number"
                  min={1}
                  step={1}
                  value={
                    capacity
                  }
                  onChange={(
                    event,
                  ) => {
                    setCapacity(
                      event
                        .target
                        .value,
                    );

                    setTiers(
                      (
                        current,
                      ) => {
                        if (
                          current.length ===
                          1
                        ) {
                          return [
                            {
                              ...current[0],

                              maxPeople:
                                event
                                  .target
                                  .value,
                            },
                          ];
                        }

                        return current;
                      },
                    );
                  }}
                  required
                  disabled={
                    loading
                  }
                />
              </div>

              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                <div className="font-bold text-indigo-950 mb-3">
                  Meeting room pricing
                </div>

                <div className="space-y-2">
                  {tiers.map(
                    (
                      tier,
                      index,
                    ) => (
                      <div
                        key={
                          index
                        }
                        className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2"
                      >
                        <input
                          className="input"
                          type="number"
                          min={1}
                          step={1}
                          placeholder="Min"
                          value={
                            tier.minPeople
                          }
                          onChange={(
                            event,
                          ) =>
                            setTiers(
                              (
                                current,
                              ) =>
                                current.map(
                                  (
                                    item,
                                    itemIndex,
                                  ) =>
                                    itemIndex ===
                                    index
                                      ? {
                                          ...item,

                                          minPeople:
                                            event
                                              .target
                                              .value,
                                        }
                                      : item,
                                ),
                            )
                          }
                          disabled={
                            loading
                          }
                        />

                        <input
                          className="input"
                          type="number"
                          min={1}
                          step={1}
                          placeholder="Max"
                          value={
                            tier.maxPeople
                          }
                          onChange={(
                            event,
                          ) =>
                            setTiers(
                              (
                                current,
                              ) =>
                                current.map(
                                  (
                                    item,
                                    itemIndex,
                                  ) =>
                                    itemIndex ===
                                    index
                                      ? {
                                          ...item,

                                          maxPeople:
                                            event
                                              .target
                                              .value,
                                        }
                                      : item,
                                ),
                            )
                          }
                          disabled={
                            loading
                          }
                        />

                        <input
                          className="input"
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder={`Rate (${currency})`}
                          value={
                            tier.hourlyRate
                          }
                          onChange={(
                            event,
                          ) =>
                            setTiers(
                              (
                                current,
                              ) =>
                                current.map(
                                  (
                                    item,
                                    itemIndex,
                                  ) =>
                                    itemIndex ===
                                    index
                                      ? {
                                          ...item,

                                          hourlyRate:
                                            event
                                              .target
                                              .value,
                                        }
                                      : item,
                                ),
                            )
                          }
                          disabled={
                            loading
                          }
                        />

                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() =>
                            setTiers(
                              (
                                current,
                              ) =>
                                current.filter(
                                  (
                                    _item,
                                    itemIndex,
                                  ) =>
                                    itemIndex !==
                                    index,
                                ),
                            )
                          }
                          disabled={
                            loading ||
                            tiers.length <=
                              1
                          }
                        >
                          ×
                        </button>
                      </div>
                    ),
                  )}
                </div>

                <button
                  type="button"
                  className="mt-3 text-sm font-semibold text-indigo-600 hover:underline"
                  onClick={() =>
                    setTiers(
                      (
                        current,
                      ) => [
                        ...current,

                        {
                          minPeople:
                            "",

                          maxPeople:
                            "",

                          hourlyRate:
                            "",
                        },
                      ],
                    )
                  }
                  disabled={
                    loading
                  }
                >
                  + Add pricing tier
                </button>

                <div className="text-xs text-slate-500 mt-3">
                  The ranges must cover every
                  attendee count from 1 to the
                  room capacity without gaps or
                  overlaps.
                </div>
              </div>
            </>
          )}

          <div>
            <label className="label">
              Sort order
            </label>

            <input
              className="input"
              type="number"
              step={1}
              value={
                sortOrder
              }
              onChange={(
                event,
              ) =>
                setSortOrder(
                  event
                    .target
                    .value,
                )
              }
              disabled={
                loading
              }
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={
                onClose
              }
              className="btn btn-ghost flex-1"
              disabled={
                loading
              }
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn btn-primary flex-1"
              disabled={
                loading
              }
            >
              {loading
                ? "Saving..."
                : "Add location"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}