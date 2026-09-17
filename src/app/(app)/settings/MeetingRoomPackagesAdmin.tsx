"use client";

import {
  useEffect,
  useState,
} from "react";

/* ============================================================================
 * TYPES
 * ========================================================================== */

type PackageStatus =
  | "active"
  | "inactive";

type MeetingRoomPackage = {
  id: number;
  name: string;
  totalHours: string;
  discountPercent: string;
  price: string;
  validityDays: number | null;
  description: string | null;
  status: PackageStatus;
  createdAt: string;
  updatedAt: string;
};

type PackageForm = {
  name: string;
  totalHours: string;
  price: string;
  validityDays: string;
  description: string;
};

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const PACKAGE_OPTIONS = [
  {
    hours: 10,
    discount: 8,
  },
  {
    hours: 20,
    discount: 12,
  },
  {
    hours: 40,
    discount: 18,
  },
] as const;

/* ============================================================================
 * HELPERS
 * ========================================================================== */

function getDiscountForHours(
  hours: number,
): number | null {
  const found =
    PACKAGE_OPTIONS.find(
      (item) =>
        item.hours === hours,
    );

  return found?.discount ?? null;
}

function formatMoney(
  value: string | number,
  currency: string,
): string {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return `0.00 ${currency}`;
  }

  return `${numberValue.toFixed(
    2,
  )} ${currency}`;
}

function emptyForm(): PackageForm {
  return {
    name: "",
    totalHours: "10",
    price: "",
    validityDays: "",
    description: "",
  };
}

/* ============================================================================
 * COMPONENT
 * ========================================================================== */

export default function MeetingRoomPackagesAdmin({
  currency,
}: {
  currency: string;
}) {
  const [
    packages,
    setPackages,
  ] = useState<
    MeetingRoomPackage[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<string | null>(
    null,
  );

  const [
    success,
    setSuccess,
  ] = useState<string | null>(
    null,
  );

  const [
    adding,
    setAdding,
  ] = useState(false);

  const [
    form,
    setForm,
  ] = useState<PackageForm>(
    emptyForm(),
  );

  const [
    editingId,
    setEditingId,
  ] = useState<number | null>(
    null,
  );

  const [
    editingForm,
    setEditingForm,
  ] = useState<
    Record<number, PackageForm>
  >({});

  /* --------------------------------------------------------------------------
   * FETCH PACKAGES
   * ------------------------------------------------------------------------ */

  async function loadPackages() {
    setLoading(true);
    setError(null);

    try {
      const response =
        await fetch(
          "/api/meeting-rooms/packages",
          {
            method: "GET",
            cache: "no-store",
          },
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        setError(
          data.error ||
            `Could not load packages (HTTP ${response.status}).`,
        );

        return;
      }

      setPackages(
        Array.isArray(
          data.packages,
        )
          ? data.packages
          : [],
      );
    } catch (requestError) {
      console.error(
        "Load meeting room packages error:",
        requestError,
      );

      setError(
        "Could not connect to the server.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPackages();
  }, []);

  /* --------------------------------------------------------------------------
   * CLEAR MESSAGES
   * ------------------------------------------------------------------------ */

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  /* --------------------------------------------------------------------------
   * FORM UPDATE
   * ------------------------------------------------------------------------ */

  function updateForm(
    field: keyof PackageForm,
    value: string,
  ) {
    setForm(
      (current) => ({
        ...current,
        [field]: value,
      }),
    );
  }

  function updateEditingForm(
    packageId: number,
    field: keyof PackageForm,
    value: string,
  ) {
    setEditingForm(
      (current) => ({
        ...current,

        [packageId]: {
          ...(current[packageId] ??
            emptyForm()),

          [field]: value,
        },
      }),
    );
  }

  /* --------------------------------------------------------------------------
   * START EDIT
   * ------------------------------------------------------------------------ */

  function startEdit(
    pkg: MeetingRoomPackage,
  ) {
    clearMessages();

    setEditingId(pkg.id);

    setEditingForm(
      (current) => ({
        ...current,

        [pkg.id]: {
          name: pkg.name,
          totalHours: String(
            Number(pkg.totalHours),
          ),
          price: String(
            Number(pkg.price),
          ),
          validityDays:
            pkg.validityDays ===
            null
              ? ""
              : String(
                  pkg.validityDays,
                ),
          description:
            pkg.description ??
            "",
        },
      }),
    );
  }

  /* --------------------------------------------------------------------------
   * CANCEL EDIT
   * ------------------------------------------------------------------------ */

  function cancelEdit() {
    setEditingId(null);
  }

  /* --------------------------------------------------------------------------
   * VALIDATE FORM
   * ------------------------------------------------------------------------ */

  function validateForm(
    currentForm: PackageForm,
  ): string | null {
    const name =
      currentForm.name.trim();

    if (name.length < 2) {
      return "Package name is required.";
    }

    if (name.length > 200) {
      return "Package name is too long.";
    }

    const totalHours =
      Number(
        currentForm.totalHours,
      );

    if (
      !Number.isInteger(
        totalHours,
      )
    ) {
      return "Package hours must be a whole number.";
    }

    const requiredDiscount =
      getDiscountForHours(
        totalHours,
      );

    if (
      requiredDiscount ===
      null
    ) {
      return "Meeting room packages can only be 10, 20, or 40 hours.";
    }

    const price =
      Number(
        currentForm.price,
      );

    if (
      !Number.isFinite(
        price,
      ) ||
      price <= 0
    ) {
      return "Package price must be greater than zero.";
    }

    if (
      currentForm.validityDays.trim() !==
      ""
    ) {
      const validityDays =
        Number(
          currentForm.validityDays,
        );

      if (
        !Number.isInteger(
          validityDays,
        ) ||
        validityDays <= 0
      ) {
        return "Validity days must be a positive whole number.";
      }
    }

    return null;
  }

  /* --------------------------------------------------------------------------
   * CREATE PACKAGE
   * ------------------------------------------------------------------------ */

  async function createPackage() {
    clearMessages();

    const validation =
      validateForm(
        form,
      );

    if (validation) {
      setError(
        validation,
      );

      return;
    }

    const totalHours =
      Number(
        form.totalHours,
      );

    const discountPercent =
      getDiscountForHours(
        totalHours,
      );

    if (
      discountPercent ===
      null
    ) {
      setError(
        "Invalid package hours.",
      );

      return;
    }

    setSaving(true);

    try {
      const response =
        await fetch(
          "/api/meeting-rooms/packages",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                name:
                  form.name.trim(),

                totalHours,

                discountPercent,

                price: Number(
                  form.price,
                ),

                validityDays:
                  form.validityDays.trim() ===
                  ""
                    ? null
                    : Number(
                        form.validityDays,
                      ),

                description:
                  form.description.trim() ||
                  null,
              }),
          },
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        setError(
          data.error ||
            `Could not create package (HTTP ${response.status}).`,
        );

        return;
      }

      setAdding(false);

      setForm(
        emptyForm(),
      );

      setSuccess(
        "Meeting room package created successfully.",
      );

      await loadPackages();
    } catch (requestError) {
      console.error(
        "Create meeting room package error:",
        requestError,
      );

      setError(
        "Could not connect to the server.",
      );
    } finally {
      setSaving(false);
    }
  }

  /* --------------------------------------------------------------------------
   * SAVE EDIT
   * ------------------------------------------------------------------------ */

  async function saveEdit(
    pkg: MeetingRoomPackage,
  ) {
    clearMessages();

    const edit =
      editingForm[
        pkg.id
      ];

    if (!edit) {
      setError(
        "Could not load the package for editing.",
      );

      return;
    }

    const validation =
      validateForm(
        edit,
      );

    if (validation) {
      setError(
        validation,
      );

      return;
    }

    const totalHours =
      Number(
        edit.totalHours,
      );

    const discountPercent =
      getDiscountForHours(
        totalHours,
      );

    if (
      discountPercent ===
      null
    ) {
      setError(
        "Invalid package hours.",
      );

      return;
    }

    setSaving(true);

    try {
      const response =
        await fetch(
          "/api/meeting-rooms/packages",
          {
            method: "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                id: pkg.id,

                name:
                  edit.name.trim(),

                totalHours,

                discountPercent,

                price: Number(
                  edit.price,
                ),

                validityDays:
                  edit.validityDays.trim() ===
                  ""
                    ? null
                    : Number(
                        edit.validityDays,
                      ),

                description:
                  edit.description.trim() ||
                  null,
              }),
          },
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        setError(
          data.error ||
            `Could not update package (HTTP ${response.status}).`,
        );

        return;
      }

      setEditingId(
        null,
      );

      setSuccess(
        "Meeting room package updated successfully.",
      );

      await loadPackages();
    } catch (requestError) {
      console.error(
        "Update meeting room package error:",
        requestError,
      );

      setError(
        "Could not connect to the server.",
      );
    } finally {
      setSaving(false);
    }
  }

  /* --------------------------------------------------------------------------
   * TOGGLE STATUS
   * ------------------------------------------------------------------------ */

  async function toggleStatus(
    pkg: MeetingRoomPackage,
  ) {
    clearMessages();

    const nextStatus: PackageStatus =
      pkg.status ===
      "active"
        ? "inactive"
        : "active";

    const confirmed =
      window.confirm(
        pkg.status ===
          "active"
          ? `Deactivate "${pkg.name}"? Existing customer purchases will remain unchanged.`
          : `Activate "${pkg.name}"?`,
      );

    if (!confirmed) {
      return;
    }

    setSaving(true);

    try {
      const response =
        await fetch(
          "/api/meeting-rooms/packages",
          {
            method: "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                id: pkg.id,
                status:
                  nextStatus,
              }),
          },
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        setError(
          data.error ||
            `Could not change package status (HTTP ${response.status}).`,
        );

        return;
      }

      setSuccess(
        `"${pkg.name}" ${
          nextStatus ===
          "active"
            ? "activated"
            : "deactivated"
        } successfully.`,
      );

      await loadPackages();
    } catch (requestError) {
      console.error(
        "Toggle meeting room package status error:",
        requestError,
      );

      setError(
        "Could not connect to the server.",
      );
    } finally {
      setSaving(false);
    }
  }

  /* --------------------------------------------------------------------------
   * RENDER
   * ------------------------------------------------------------------------ */

  return (
    <div className="space-y-5">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900">
            🎟️ Meeting Room Packages
          </h3>

          <p className="text-sm text-slate-500 mt-1">
            Manage the 10, 20 and 40
            hour meeting-room packages.
            Customer purchases keep their
            historical package snapshot.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            clearMessages();
            setAdding(
              true,
            );
            setForm(
              emptyForm(),
            );
          }}
          disabled={
            saving
          }
        >
          + Add package
        </button>
      </div>

      {/* BUSINESS RULES */}
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
        <div className="font-semibold text-indigo-950">
          Package rules
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mt-3">
          {PACKAGE_OPTIONS.map(
            (option) => (
              <div
                key={
                  option.hours
                }
                className="rounded-xl bg-white border border-indigo-100 p-3"
              >
                <div className="font-bold text-indigo-950">
                  {option.hours} hours
                </div>

                <div className="text-sm text-indigo-700 mt-1">
                  {option.discount}%
                  discount
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      {/* MESSAGES */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          {success}
        </div>
      )}

      {/* ADD FORM */}
      {adding && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-bold text-slate-900">
                Add package
              </div>

              <div className="text-xs text-slate-500 mt-1">
                The server will enforce the
                package discount rules.
              </div>
            </div>

            <button
              type="button"
              className="text-slate-400 hover:text-slate-700 text-xl"
              onClick={() => {
                setAdding(
                  false,
                );
                clearMessages();
              }}
              disabled={
                saving
              }
            >
              ×
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">
                Package name
              </label>

              <input
                className="input"
                value={
                  form.name
                }
                onChange={(
                  event,
                ) =>
                  updateForm(
                    "name",
                    event.target
                      .value,
                  )
                }
                placeholder="e.g. Meeting Room 10 Hours"
                disabled={
                  saving
                }
              />
            </div>

            <div>
              <label className="label">
                Hours
              </label>

              <select
                className="input"
                value={
                  form.totalHours
                }
                onChange={(
                  event,
                ) =>
                  updateForm(
                    "totalHours",
                    event.target
                      .value,
                  )
                }
                disabled={
                  saving
                }
              >
                {PACKAGE_OPTIONS.map(
                  (option) => (
                    <option
                      key={
                        option.hours
                      }
                      value={
                        option.hours
                      }
                    >
                      {option.hours} hours
                      {" "}
                      ({option.discount}% discount)
                    </option>
                  ),
                )}
              </select>
            </div>

            <div>
              <label className="label">
                Selling price (
                {currency}
                )
              </label>

              <input
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                value={
                  form.price
                }
                onChange={(
                  event,
                ) =>
                  updateForm(
                    "price",
                    event.target
                      .value,
                  )
                }
                placeholder="Enter selling price"
                disabled={
                  saving
                }
              />
            </div>

            <div>
              <label className="label">
                Validity days
              </label>

              <input
                className="input"
                type="number"
                min={1}
                step={1}
                value={
                  form.validityDays
                }
                onChange={(
                  event,
                ) =>
                  updateForm(
                    "validityDays",
                    event.target
                      .value,
                  )
                }
                placeholder="Leave empty for no expiry"
                disabled={
                  saving
                }
              />
            </div>

            <div className="md:col-span-2">
              <label className="label">
                Description
              </label>

              <textarea
                className="input min-h-24"
                value={
                  form.description
                }
                onChange={(
                  event,
                ) =>
                  updateForm(
                    "description",
                    event.target
                      .value,
                  )
                }
                placeholder="Optional description"
                disabled={
                  saving
                }
              />
            </div>
          </div>

          <div className="flex gap-2 mt-5">
            <button
              type="button"
              className="btn btn-ghost flex-1"
              onClick={() => {
                setAdding(
                  false,
                );
                clearMessages();
              }}
              disabled={
                saving
              }
            >
              Cancel
            </button>

            <button
              type="button"
              className="btn btn-primary flex-1"
              onClick={() =>
                void createPackage()
              }
              disabled={
                saving
              }
            >
              {saving
                ? "Saving..."
                : "Create package"}
            </button>
          </div>
        </div>
      )}

      {/* PACKAGE LIST */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">
            Loading meeting room packages...
          </div>
        ) : packages.length ===
          0 ? (
          <div className="rounded-2xl border border-slate-200 p-6">
            <div className="font-semibold text-slate-800">
              No meeting room packages configured.
            </div>

            <div className="text-sm text-slate-500 mt-1">
              Create the 10, 20 and 40 hour
              packages with their selling prices.
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase text-left">
              <tr>
                <th className="py-3 pr-4">
                  Package
                </th>

                <th className="py-3 pr-4">
                  Hours
                </th>

                <th className="py-3 pr-4">
                  Discount
                </th>

                <th className="py-3 pr-4">
                  Price
                </th>

                <th className="py-3 pr-4">
                  Validity
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
              {packages.map(
                (pkg) => {
                  const editing =
                    editingId ===
                    pkg.id;

                  const edit =
                    editingForm[
                      pkg.id
                    ];

                  return (
                    <tr
                      key={
                        pkg.id
                      }
                      className="border-t border-slate-100 align-top"
                    >
                      {/* PACKAGE */}
                      <td className="py-4 pr-4 min-w-64">
                        {editing &&
                        edit ? (
                          <div className="space-y-2">
                            <input
                              className="input !py-1 w-full"
                              value={
                                edit.name
                              }
                              onChange={(
                                event,
                              ) =>
                                updateEditingForm(
                                  pkg.id,
                                  "name",
                                  event
                                    .target
                                    .value,
                                )
                              }
                              disabled={
                                saving
                              }
                            />

                            <textarea
                              className="input !py-1 w-full min-h-20"
                              value={
                                edit.description
                              }
                              onChange={(
                                event,
                              ) =>
                                updateEditingForm(
                                  pkg.id,
                                  "description",
                                  event
                                    .target
                                    .value,
                                )
                              }
                              placeholder="Description"
                              disabled={
                                saving
                              }
                            />
                          </div>
                        ) : (
                          <div>
                            <div className="font-semibold text-slate-900">
                              {
                                pkg.name
                              }
                            </div>

                            {pkg.description && (
                              <div className="text-xs text-slate-500 mt-1">
                                {
                                  pkg.description
                                }
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* HOURS */}
                      <td className="py-4 pr-4 min-w-28">
                        {editing &&
                        edit ? (
                          <select
                            className="input !py-1"
                            value={
                              edit.totalHours
                            }
                            onChange={(
                              event,
                            ) =>
                              updateEditingForm(
                                pkg.id,
                                "totalHours",
                                event
                                  .target
                                  .value,
                              )
                            }
                            disabled={
                              saving
                            }
                          >
                            {PACKAGE_OPTIONS.map(
                              (
                                option,
                              ) => (
                                <option
                                  key={
                                    option.hours
                                  }
                                  value={
                                    option.hours
                                  }
                                >
                                  {
                                    option.hours
                                  }
                                </option>
                              ),
                            )}
                          </select>
                        ) : (
                          <span>
                            {
                              Number(
                                pkg.totalHours,
                              )
                            }{" "}
                            h
                          </span>
                        )}
                      </td>

                      {/* DISCOUNT */}
                      <td className="py-4 pr-4 min-w-28">
                        <span className="font-semibold text-emerald-700">
                          {
                            Number(
                              pkg.discountPercent,
                            )
                          }
                          %
                        </span>
                      </td>

                      {/* PRICE */}
                      <td className="py-4 pr-4 min-w-32">
                        {editing &&
                        edit ? (
                          <input
                            className="input !py-1 w-32"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={
                              edit.price
                            }
                            onChange={(
                              event,
                            ) =>
                              updateEditingForm(
                                pkg.id,
                                "price",
                                event
                                  .target
                                  .value,
                              )
                            }
                            disabled={
                              saving
                            }
                          />
                        ) : (
                          <span className="font-semibold">
                            {formatMoney(
                              pkg.price,
                              currency,
                            )}
                          </span>
                        )}
                      </td>

                      {/* VALIDITY */}
                      <td className="py-4 pr-4 min-w-36">
                        {editing &&
                        edit ? (
                          <input
                            className="input !py-1 w-32"
                            type="number"
                            min={1}
                            step={1}
                            value={
                              edit.validityDays
                            }
                            onChange={(
                              event,
                            ) =>
                              updateEditingForm(
                                pkg.id,
                                "validityDays",
                                event
                                  .target
                                  .value,
                              )
                            }
                            placeholder="No expiry"
                            disabled={
                              saving
                            }
                          />
                        ) : (
                          <span>
                            {pkg.validityDays ===
                            null
                              ? "No expiry"
                              : `${pkg.validityDays} days`}
                          </span>
                        )}
                      </td>

                      {/* STATUS */}
                      <td className="py-4 pr-4">
                        <span
                          className={`badge ${
                            pkg.status ===
                            "active"
                              ? "badge-green"
                              : "badge-red"
                          }`}
                        >
                          {pkg.status ===
                          "active"
                            ? "Active"
                            : "Inactive"}
                        </span>
                      </td>

                      {/* ACTIONS */}
                      <td className="py-4 text-right">
                        {editing &&
                        edit ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className="btn btn-success !py-1 !px-2 text-xs"
                              onClick={() =>
                                void saveEdit(
                                  pkg,
                                )
                              }
                              disabled={
                                saving
                              }
                            >
                              {saving
                                ? "Saving..."
                                : "Save"}
                            </button>

                            <button
                              type="button"
                              className="btn btn-ghost !py-1 !px-2 text-xs"
                              onClick={
                                cancelEdit
                              }
                              disabled={
                                saving
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
                                startEdit(
                                  pkg,
                                )
                              }
                              disabled={
                                saving
                              }
                            >
                              ✏️ Edit
                            </button>

                            <button
                              type="button"
                              className="btn btn-ghost !py-1 !px-2 text-xs"
                              onClick={() =>
                                void toggleStatus(
                                  pkg,
                                )
                              }
                              disabled={
                                saving
                              }
                            >
                              {pkg.status ===
                              "active"
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
        )}
      </div>
    </div>
  );
}