import { NextResponse } from "next/server";

import {
  and,
  eq,
  gt,
  lt,
  sql,
} from "drizzle-orm";

import { db } from "@/db";

import {
  auditLogs,
  customerMeetingRoomPackages,
  customers,
  desks,
  meetingRoomCalendars,
  meetingRoomPackageUsageLedger,
  meetingRoomReservations,
} from "@/db/schema";

import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";

import {
  calculateMeetingRoomBooking,
  validateAttendeeCount,
  validateMeetingRoomDuration,
} from "@/lib/meeting-room-billing";

import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getCalendarBusyPeriods,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  deskId?: unknown;
  customerId?: unknown;
  customerName?: unknown;
  customerPhone?: unknown;
  attendeeCount?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  recurrence?: unknown;
  recurrenceCount?: unknown;
  packagePurchaseId?: unknown;
  notes?: unknown;
};

const HOUR_MS = 60 * 60 * 1000;
const MAX_RECURRING_OCCURRENCES = 52;

function parsePositiveInteger(
  value: unknown,
): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    return null;
  }

  return parsed;
}

function normalizePhone(
  value: string,
): string {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (digits.startsWith("0020")) {
    return `20${digits.slice(4)}`;
  }

  if (digits.startsWith("20")) {
    return digits;
  }

  if (digits.startsWith("0")) {
    return `20${digits.slice(1)}`;
  }

  return digits;
}

function isValidDate(
  value: Date,
): boolean {
  return !Number.isNaN(value.getTime());
}

function addDays(
  date: Date,
  days: number,
): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function buildOccurrenceDates(
  start: Date,
  end: Date,
  recurrence: "none" | "weekly",
  count: number,
): Array<{
  start: Date;
  end: Date;
}> {
  if (recurrence === "none") {
    return [
      {
        start: new Date(start),
        end: new Date(end),
      },
    ];
  }

  return Array.from(
    {
      length: count,
    },
    (_, index) => ({
      start: addDays(start, index * 7),
      end: addDays(end, index * 7),
    }),
  );
}

async function findInternalConflict(
  tx: any,
  roomId: number,
  start: Date,
  end: Date,
) {
  const rows = await tx
    .select({
      id: meetingRoomReservations.id,
      startAt: meetingRoomReservations.startAt,
      endAt: meetingRoomReservations.endAt,
    })
    .from(meetingRoomReservations)
    .where(
      and(
        eq(
          meetingRoomReservations.deskId,
          roomId,
        ),
        eq(
          meetingRoomReservations.status,
          "confirmed",
        ),
        lt(
          meetingRoomReservations.startAt,
          end,
        ),
        gt(
          meetingRoomReservations.endAt,
          start,
        ),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function checkGoogleAvailability(
  calendarId: string,
  occurrences: Array<{
    start: Date;
    end: Date;
  }>,
) {
  for (const occurrence of occurrences) {
    const busy = await getCalendarBusyPeriods(
      calendarId,
      occurrence.start.toISOString(),
      occurrence.end.toISOString(),
    );

    if (busy.length > 0) {
      return {
        available: false,
        start: occurrence.start.toISOString(),
        end: occurrence.end.toISOString(),
      };
    }
  }

  return {
    available: true,
  };
}

function normalizeNotes(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Invalid reservation notes.");
  }

  const notes = value.trim();

  if (!notes) {
    return null;
  }

  if (notes.length > 2000) {
    throw new Error(
      "Reservation notes are too long.",
    );
  }

  return notes;
}

function getSafeErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (
    error instanceof Error &&
    error.message
  ) {
    return error.message;
  }

  return fallback;
}

function isConflictError(
  message: string,
): boolean {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("already booked") ||
    normalized.includes("already busy") ||
    normalized.includes("already") ||
    normalized.includes("booked by another request") ||
    normalized.includes("no longer available") ||
    normalized.includes("capacity")
  );
}

export async function POST(
  req: Request,
) {
  const createdGoogleEvents: Array<{
    calendarId: string;
    eventId: string;
  }> = [];

  let googleCleanupDone = false;

  async function rollbackGoogleEvents() {
    if (googleCleanupDone) {
      return;
    }

    googleCleanupDone = true;

    for (const event of createdGoogleEvents) {
      try {
        await deleteGoogleCalendarEvent(
          event.calendarId,
          event.eventId,
        );
      } catch (error) {
        console.error(
          "[Meeting Room] Failed to rollback Google Calendar event:",
          {
            eventId: event.eventId,
            error,
          },
        );
      }
    }

    createdGoogleEvents.length = 0;
  }

  try {
    // ---------------------------------------------------------------------------
    // AUTHENTICATION
    // ---------------------------------------------------------------------------

    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    // ---------------------------------------------------------------------------
    // AUTHORIZATION
    // ---------------------------------------------------------------------------

    if (!canManage(user.role)) {
      return NextResponse.json(
        {
          error:
            "Only managers/admins can create meeting-room reservations.",
        },
        {
          status: 403,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    // ---------------------------------------------------------------------------
    // BODY
    // ---------------------------------------------------------------------------

    const body = (await req
      .json()
      .catch(() => null)) as Body | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        {
          error: "Invalid request body.",
        },
        {
          status: 400,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // ROOM
    // ---------------------------------------------------------------------------

    const deskId = parsePositiveInteger(
      body.deskId,
    );

    if (!deskId) {
      return NextResponse.json(
        {
          error:
            "A valid meeting room is required.",
        },
        {
          status: 400,
        },
      );
    }

    const [room] = await db
      .select({
        id: desks.id,
        name: desks.name,
        type: desks.type,
        active: desks.active,
        capacity: desks.capacity,
      })
      .from(desks)
      .where(
        and(
          eq(desks.id, deskId),
          eq(desks.type, "meeting_room"),
          eq(desks.active, true),
        ),
      )
      .limit(1);

    if (!room) {
      return NextResponse.json(
        {
          error:
            "Meeting room not found or inactive.",
        },
        {
          status: 404,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // ATTENDEES
    // ---------------------------------------------------------------------------

    const attendeeCount =
      parsePositiveInteger(
        body.attendeeCount,
      );

    if (!attendeeCount) {
      return NextResponse.json(
        {
          error:
            "Attendee count is required and must be greater than zero.",
        },
        {
          status: 400,
        },
      );
    }

    try {
      validateAttendeeCount(
        attendeeCount,
        room.capacity,
      );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid attendee count.",
        },
        {
          status: 400,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // CUSTOMER INPUT
    // ---------------------------------------------------------------------------

    const suppliedCustomerId =
      parsePositiveInteger(
        body.customerId,
      );

    let normalizedPhone = "";

    if (body.customerId !== undefined && body.customerId !== null) {
      if (!suppliedCustomerId) {
        return NextResponse.json(
          {
            error:
              "Invalid customer ID.",
          },
          {
            status: 400,
          },
        );
      }
    }

    if (!suppliedCustomerId) {
      if (
        typeof body.customerName !== "string" ||
        typeof body.customerPhone !== "string"
      ) {
        return NextResponse.json(
          {
            error:
              "Customer name and phone are required.",
          },
          {
            status: 400,
          },
        );
      }

      const customerName =
        body.customerName.trim();

      const customerPhone =
        body.customerPhone.trim();

      if (
        !customerName ||
        !customerPhone
      ) {
        return NextResponse.json(
          {
            error:
              "Customer name and phone are required.",
          },
          {
            status: 400,
          },
        );
      }

      if (customerName.length > 200) {
        return NextResponse.json(
          {
            error:
              "Customer name is too long.",
          },
          {
            status: 400,
          },
        );
      }

      normalizedPhone =
        normalizePhone(customerPhone);

      if (
        normalizedPhone.length < 8 ||
        normalizedPhone.length > 20
      ) {
        return NextResponse.json(
          {
            error:
              "Please enter a valid customer phone number.",
          },
          {
            status: 400,
          },
        );
      }
    }

    // ---------------------------------------------------------------------------
    // TIME INPUT
    // ---------------------------------------------------------------------------

    if (
      typeof body.startAt !== "string" ||
      typeof body.endAt !== "string" ||
      !body.startAt.trim() ||
      !body.endAt.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "Start and end time are required.",
        },
        {
          status: 400,
        },
      );
    }

    const start = new Date(
      body.startAt,
    );

    const end = new Date(
      body.endAt,
    );

    if (
      !isValidDate(start) ||
      !isValidDate(end)
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid reservation time.",
        },
        {
          status: 400,
        },
      );
    }

    const now = new Date();

    if (start <= now) {
      return NextResponse.json(
        {
          error:
            "Reservation must be in the future.",
        },
        {
          status: 400,
        },
      );
    }

    if (end <= start) {
      return NextResponse.json(
        {
          error:
            "End time must be after start time.",
        },
        {
          status: 400,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // DURATION
    // ---------------------------------------------------------------------------

    const durationMs =
      end.getTime() -
      start.getTime();

    if (
      durationMs % HOUR_MS !== 0
    ) {
      return NextResponse.json(
        {
          error:
            "Meeting room reservations must use full hours only. 1:30 hour bookings are not allowed.",
        },
        {
          status: 400,
        },
      );
    }

    const durationHours =
      durationMs / HOUR_MS;

    try {
      validateMeetingRoomDuration(
        durationHours,
      );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid reservation duration.",
        },
        {
          status: 400,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // RECURRENCE
    // ---------------------------------------------------------------------------

    let recurrence:
      | "none"
      | "weekly";

    if (
      body.recurrence === undefined ||
      body.recurrence === null
    ) {
      recurrence = "none";
    } else if (
      body.recurrence === "none" ||
      body.recurrence === "weekly"
    ) {
      recurrence = body.recurrence;
    } else {
      return NextResponse.json(
        {
          error:
            "Invalid recurrence value.",
        },
        {
          status: 400,
        },
      );
    }

    let recurrenceCount = 1;

    if (recurrence === "weekly") {
      const requestedCount =
        parsePositiveInteger(
          body.recurrenceCount ?? 1,
        );

      if (
        !requestedCount ||
        requestedCount >
          MAX_RECURRING_OCCURRENCES
      ) {
        return NextResponse.json(
          {
            error:
              `Weekly recurrence count must be between 1 and ${MAX_RECURRING_OCCURRENCES}.`,
          },
          {
            status: 400,
          },
        );
      }

      recurrenceCount =
        requestedCount;
    } else if (
      body.recurrenceCount !== undefined &&
      body.recurrenceCount !== null
    ) {
      const parsed =
        parsePositiveInteger(
          body.recurrenceCount,
        );

      if (
        parsed !== null &&
        parsed !== 1
      ) {
        return NextResponse.json(
          {
            error:
              "recurrenceCount is only supported for weekly reservations.",
          },
          {
            status: 400,
          },
        );
      }
    }

    const occurrences =
      buildOccurrenceDates(
        start,
        end,
        recurrence,
        recurrenceCount,
      );

    for (const occurrence of occurrences) {
      if (
        occurrence.start <= now
      ) {
        return NextResponse.json(
          {
            error:
              "One of the requested recurring reservations is no longer in the future.",
          },
          {
            status: 400,
          },
        );
      }
    }

    // ---------------------------------------------------------------------------
    // NOTES
    // ---------------------------------------------------------------------------

    let notes: string | null;

    try {
      notes = normalizeNotes(
        body.notes,
      );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid reservation notes.",
        },
        {
          status: 400,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // PACKAGE ID
    // ---------------------------------------------------------------------------

    let packagePurchaseId:
      | number
      | null = null;

    if (
      body.packagePurchaseId !== undefined &&
      body.packagePurchaseId !== null
    ) {
      packagePurchaseId =
        parsePositiveInteger(
          body.packagePurchaseId,
        );

      if (!packagePurchaseId) {
        return NextResponse.json(
          {
            error:
              "Invalid meeting room package purchase ID.",
          },
          {
            status: 400,
          },
        );
      }
    }

    // ---------------------------------------------------------------------------
    // GOOGLE CALENDAR MAPPING
    // ---------------------------------------------------------------------------

    const [mapping] = await db
      .select({
        calendarId:
          meetingRoomCalendars.calendarId,
        calendarName:
          meetingRoomCalendars.calendarName,
      })
      .from(meetingRoomCalendars)
      .where(
        eq(
          meetingRoomCalendars.deskId,
          room.id,
        ),
      )
      .limit(1);

    if (!mapping) {
      return NextResponse.json(
        {
          error:
            "This meeting room is not linked to Google Calendar yet.",
        },
        {
          status: 400,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // EARLY INTERNAL CONFLICT CHECK
    // ---------------------------------------------------------------------------

    for (const occurrence of occurrences) {
      const conflict =
        await findInternalConflict(
          db,
          room.id,
          occurrence.start,
          occurrence.end,
        );

      if (conflict) {
        return NextResponse.json(
          {
            error:
              "The meeting room is already booked for one of the requested times.",
            conflictingStart:
              conflict.startAt.toISOString(),
            conflictingEnd:
              conflict.endAt.toISOString(),
          },
          {
            status: 409,
          },
        );
      }
    }

    // ---------------------------------------------------------------------------
    // EARLY GOOGLE CONFLICT CHECK
    // ---------------------------------------------------------------------------

    try {
      const googleAvailability =
        await checkGoogleAvailability(
          mapping.calendarId,
          occurrences,
        );

      if (
        !googleAvailability.available
      ) {
        return NextResponse.json(
          {
            error:
              "The meeting room is already busy in Google Calendar for one of the requested times.",
            conflictingStart:
              googleAvailability.start,
            conflictingEnd:
              googleAvailability.end,
          },
          {
            status: 409,
          },
        );
      }
    } catch (error) {
      console.error(
        "[Meeting Room] Google Calendar availability check failed:",
        error,
      );

      return NextResponse.json(
        {
          error:
            "Could not verify Google Calendar availability.",
        },
        {
          status: 502,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // BILLING PREVIEW
    //
    // This is used for the Google Calendar description and initial validation.
    // Final persisted values are calculated again inside the transaction.
    // ---------------------------------------------------------------------------

    let baseBilling;

    try {
      baseBilling =
        await calculateMeetingRoomBooking({
          deskId: room.id,
          attendeeCount,
          durationHours,
        });
    } catch (error) {
      console.error(
        "[Meeting Room] Billing calculation failed:",
        error,
      );

      return NextResponse.json(
        {
          error:
            "Could not calculate meeting room pricing.",
        },
        {
          status: 500,
        },
      );
    }

    const previewSubtotal =
      Number(
        baseBilling.subtotalAmount,
      );

    if (
      !Number.isFinite(previewSubtotal) ||
      previewSubtotal < 0
    ) {
      console.error(
        "[Meeting Room] Invalid billing result:",
        baseBilling,
      );

      return NextResponse.json(
        {
          error:
            "Invalid meeting room billing result.",
        },
        {
          status: 500,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // CUSTOMER DISPLAY NAME
    // ---------------------------------------------------------------------------

    const customerDisplayName =
      typeof body.customerName === "string" &&
      body.customerName.trim()
        ? body.customerName.trim()
        : "Customer";

    // ---------------------------------------------------------------------------
    // CREATE GOOGLE EVENTS
    //
    // Google events are created before the DB transaction. Every successfully
    // created event is tracked so it can be removed if the DB transaction fails.
    // ---------------------------------------------------------------------------

    for (const occurrence of occurrences) {
      try {
        const result =
          await createGoogleCalendarEvent(
            mapping.calendarId,
            {
              summary:
                `Meeting Room - ${room.name}`,

              description: [
                `Customer: ${customerDisplayName}`,
                `Attendees: ${attendeeCount}`,
                `Duration: ${durationHours} hour(s)`,
                packagePurchaseId
                  ? "Billing: Meeting Room Package"
                  : "Billing: Regular",
                recurrence === "weekly"
                  ? `Weekly occurrences: ${recurrenceCount}`
                  : "",
                notes
                  ? `Notes: ${notes}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),

              start:
                occurrence.start.toISOString(),

              end:
                occurrence.end.toISOString(),
            },
          );

        if (!result.id) {
          throw new Error(
            "Google Calendar created the event but did not return an event ID.",
          );
        }

        createdGoogleEvents.push({
          calendarId:
            mapping.calendarId,
          eventId: result.id,
        });
      } catch (error) {
        console.error(
          "[Meeting Room] Google Calendar reservation failed:",
          error,
        );

        await rollbackGoogleEvents();

        return NextResponse.json(
          {
            error:
              "Google Calendar reservation failed.",
          },
          {
            status: 502,
          },
        );
      }
    }

    // ---------------------------------------------------------------------------
    // DATABASE TRANSACTION
    // ---------------------------------------------------------------------------

    try {
      const transactionResult =
        await db.transaction(
          async (tx) => {
            // ---------------------------------------------------------------------
            // ROOM LOCK
            // ---------------------------------------------------------------------

            await tx.execute(
              sql`
                SELECT pg_advisory_xact_lock(
                  29001,
                  ${room.id}
                )
              `,
            );

            // ---------------------------------------------------------------------
            // RECHECK ROOM
            // ---------------------------------------------------------------------

            const [lockedRoom] =
              await tx
                .select({
                  id: desks.id,
                  name: desks.name,
                  capacity:
                    desks.capacity,
                  active:
                    desks.active,
                  type: desks.type,
                })
                .from(desks)
                .where(
                  and(
                    eq(
                      desks.id,
                      room.id,
                    ),
                    eq(
                      desks.type,
                      "meeting_room",
                    ),
                    eq(
                      desks.active,
                      true,
                    ),
                  ),
                )
                .limit(1);

            if (!lockedRoom) {
              throw new Error(
                "Meeting room is no longer available.",
              );
            }

            if (
              attendeeCount >
              lockedRoom.capacity
            ) {
              throw new Error(
                `The meeting room capacity is ${lockedRoom.capacity} people.`,
              );
            }

            // ---------------------------------------------------------------------
            // PHONE LOCK
            // ---------------------------------------------------------------------

            if (!suppliedCustomerId) {
              await tx.execute(
                sql`
                  SELECT pg_advisory_xact_lock(
                    hashtextextended(
                      ${normalizedPhone},
                      0
                    )
                  )
                `,
              );
            }

            // ---------------------------------------------------------------------
            // FINAL INTERNAL CONFLICT CHECK
            // ---------------------------------------------------------------------

            for (const occurrence of occurrences) {
              const conflict =
                await findInternalConflict(
                  tx,
                  lockedRoom.id,
                  occurrence.start,
                  occurrence.end,
                );

              if (conflict) {
                throw new Error(
                  "The meeting room was booked by another request while this reservation was being processed.",
                );
              }
            }

            // ---------------------------------------------------------------------
            // CUSTOMER
            // ---------------------------------------------------------------------

            let customer:
              | {
                  id: number;
                  name: string;
                  phone: string;
                }
              | undefined;

            if (suppliedCustomerId) {
              const customerRows =
                await tx
                  .select({
                    id: customers.id,
                    name: customers.name,
                    phone: customers.phone,
                  })
                  .from(customers)
                  .where(
                    eq(
                      customers.id,
                      suppliedCustomerId,
                    ),
                  )
                  .limit(1);

              customer =
                customerRows[0];

              if (!customer) {
                throw new Error(
                  "The selected customer no longer exists.",
                );
              }
            } else {
              const existingRows =
                await tx
                  .select({
                    id: customers.id,
                    name: customers.name,
                    phone: customers.phone,
                  })
                  .from(customers)
                  .where(
                    eq(
                      customers.phoneNormalized,
                      normalizedPhone,
                    ),
                  )
                  .limit(1);

              customer =
                existingRows[0];

              if (!customer) {
                const customerName =
                  body.customerName
                    ?.toString()
                    .trim() ?? "";

                const customerPhone =
                  body.customerPhone
                    ?.toString()
                    .trim() ?? "";

                if (
                  !customerName ||
                  !customerPhone
                ) {
                  throw new Error(
                    "Customer name and phone are required.",
                  );
                }

                const inserted =
                  await tx
                    .insert(customers)
                    .values({
                      name:
                        customerName,
                      phone:
                        customerPhone,
                      phoneNormalized:
                        normalizedPhone,
                    })
                    .returning({
                      id: customers.id,
                      name:
                        customers.name,
                      phone:
                        customers.phone,
                    });

                customer =
                  inserted[0];
              }

              if (!customer) {
                throw new Error(
                  "Could not resolve the customer.",
                );
              }
            }

            // ---------------------------------------------------------------------
            // PACKAGE
            // ---------------------------------------------------------------------

            let packageBalance = 0;

            const packageHoursRequired =
              durationHours *
              occurrences.length;

            let packageDiscountPercent = 0;

            let packagePurchase:
              | {
                  id: number;
                  customerId: number;
                  discountPercent: number;
                  expiresAt:
                    | Date
                    | null;
                }
              | null = null;

            if (packagePurchaseId) {
              await tx.execute(
                sql`
                  SELECT id
                  FROM customer_meeting_room_packages
                  WHERE id = ${packagePurchaseId}
                  FOR UPDATE
                `,
              );

              const [purchase] =
                await tx
                  .select({
                    id:
                      customerMeetingRoomPackages.id,

                    customerId:
                      customerMeetingRoomPackages.customerId,

                    discountPercentSnapshot:
                      customerMeetingRoomPackages.discountPercentSnapshot,

                    status:
                      customerMeetingRoomPackages.status,

                    expiresAt:
                      customerMeetingRoomPackages.expiresAt,
                  })
                  .from(
                    customerMeetingRoomPackages,
                  )
                  .where(
                    eq(
                      customerMeetingRoomPackages.id,
                      packagePurchaseId,
                    ),
                  )
                  .limit(1);

              if (!purchase) {
                throw new Error(
                  "Meeting room package purchase not found.",
                );
              }

              if (
                purchase.customerId !==
                customer.id
              ) {
                throw new Error(
                  "The selected meeting room package does not belong to this customer.",
                );
              }

              if (
                purchase.status !==
                "active"
              ) {
                throw new Error(
                  "This meeting room package is not active.",
                );
              }

              if (
                purchase.expiresAt &&
                purchase.expiresAt <=
                  new Date()
              ) {
                await tx
                  .update(
                    customerMeetingRoomPackages,
                  )
                  .set({
                    status:
                      "expired",
                    updatedAt:
                      new Date(),
                  })
                  .where(
                    eq(
                      customerMeetingRoomPackages.id,
                      packagePurchaseId,
                    ),
                  );

                throw new Error(
                  "This meeting room package has expired.",
                );
              }

              packageDiscountPercent =
                Number(
                  purchase.discountPercentSnapshot,
                );

              if (
                !Number.isFinite(
                  packageDiscountPercent,
                ) ||
                packageDiscountPercent <
                  0 ||
                packageDiscountPercent >
                  100
              ) {
                throw new Error(
                  "Invalid meeting room package discount.",
                );
              }

              const ledgerRows =
                await tx
                  .select({
                    hoursDelta:
                      meetingRoomPackageUsageLedger.hoursDelta,
                  })
                  .from(
                    meetingRoomPackageUsageLedger,
                  )
                  .where(
                    eq(
                      meetingRoomPackageUsageLedger.packagePurchaseId,
                      packagePurchaseId,
                    ),
                  );

              packageBalance =
                ledgerRows.reduce(
                  (
                    total,
                    row,
                  ) => {
                    const value =
                      Number(
                        row.hoursDelta,
                      );

                    return Number.isFinite(
                      value,
                    )
                      ? total + value
                      : total;
                  },
                  0,
                );

              packageBalance =
                Math.round(
                  packageBalance * 100,
                ) / 100;

              if (
                packageBalance <
                packageHoursRequired
              ) {
                throw new Error(
                  `Insufficient meeting room package balance. Remaining: ${packageBalance} hours, required: ${packageHoursRequired} hours.`,
                );
              }

              packagePurchase = {
                id: purchase.id,
                customerId:
                  purchase.customerId,
                discountPercent:
                  packageDiscountPercent,
                expiresAt:
                  purchase.expiresAt,
              };
            }

            // ---------------------------------------------------------------------
            // FINAL BILLING
            //
            // Recalculate inside the transaction so the stored snapshot is based
            // on the current pricing rules at the moment of reservation creation.
            // ---------------------------------------------------------------------

            const finalBilling =
              await calculateMeetingRoomBooking({
                deskId: lockedRoom.id,
                attendeeCount,
                durationHours,
              });

            const subtotalPerOccurrence =
              Math.round(
                Number(
                  finalBilling.subtotalAmount,
                ) * 100,
              ) / 100;

            const finalHourlyRate =
              Number(
                finalBilling.hourlyRate,
              );

            if (
              !Number.isFinite(
                subtotalPerOccurrence,
              ) ||
              subtotalPerOccurrence <
                0 ||
              !Number.isFinite(
                finalHourlyRate,
              ) ||
              finalHourlyRate < 0
            ) {
              throw new Error(
                "Invalid meeting room billing result.",
              );
            }

            const discountPerOccurrence =
              packagePurchase
                ? Math.round(
                    subtotalPerOccurrence *
                      (packageDiscountPercent /
                        100) *
                      100,
                  ) / 100
                : 0;

            const totalPerOccurrence =
              Math.round(
                (
                  subtotalPerOccurrence -
                  discountPerOccurrence
                ) *
                  100,
              ) / 100;

            const totalSubtotal =
              Math.round(
                subtotalPerOccurrence *
                  occurrences.length *
                  100,
              ) / 100;

            const totalDiscount =
              Math.round(
                discountPerOccurrence *
                  occurrences.length *
                  100,
              ) / 100;

            const totalAmount =
              Math.round(
                totalPerOccurrence *
                  occurrences.length *
                  100,
              ) / 100;

            // ---------------------------------------------------------------------
            // INSERT RESERVATIONS
            // ---------------------------------------------------------------------

            const insertedReservations:
              Array<{
                id: number;
                googleEventId:
                  | string
                  | null;
                startAt: Date;
                endAt: Date;
              }> = [];

            for (
              let index = 0;
              index <
              occurrences.length;
              index += 1
            ) {
              const occurrence =
                occurrences[index];

              const googleEvent =
                createdGoogleEvents[index];

              if (!googleEvent) {
                throw new Error(
                  "Missing Google Calendar event for one of the reservations.",
                );
              }

              const [reservation] =
                await tx
                  .insert(
                    meetingRoomReservations,
                  )
                  .values({
                    deskId:
                      lockedRoom.id,

                    customerId:
                      customer.id,

                    userId:
                      user.id,

                    startAt:
                      occurrence.start,

                    endAt:
                      occurrence.end,

                    attendeeCount:
                      attendeeCount,

                    hourlyRateSnapshot:
                      finalHourlyRate
                        .toFixed(2),

                    durationHours:
                      durationHours.toFixed(
                        2,
                      ),

                    subtotalAmount:
                      subtotalPerOccurrence.toFixed(
                        2,
                      ),

                    discountPercentSnapshot:
                      packagePurchase
                        ? packageDiscountPercent.toFixed(
                            2,
                          )
                        : "0.00",

                    discountAmount:
                      discountPerOccurrence.toFixed(
                        2,
                      ),

                    totalAmount:
                      totalPerOccurrence.toFixed(
                        2,
                      ),

                    packagePurchaseId:
                      packagePurchaseId ??
                      null,

                    packageHoursUsed:
                      packagePurchase
                        ? durationHours.toFixed(
                            2,
                          )
                        : null,

                    recurrenceRule:
                      recurrence === "weekly"
                        ? `RRULE:FREQ=WEEKLY;COUNT=${recurrenceCount}`
                        : null,

                    recurrenceCount:
                      recurrenceCount > 1
                        ? recurrenceCount
                        : null,

                    googleEventId:
                      googleEvent.eventId,

                    status:
                      "confirmed",

                    notes,
                  })
                  .returning({
                    id:
                      meetingRoomReservations.id,

                    googleEventId:
                      meetingRoomReservations.googleEventId,

                    startAt:
                      meetingRoomReservations.startAt,

                    endAt:
                      meetingRoomReservations.endAt,
                  });

              if (!reservation) {
                throw new Error(
                  "Could not create the meeting room reservation.",
                );
              }

              insertedReservations.push(
                reservation,
              );
            }

            // ---------------------------------------------------------------------
            // PACKAGE USAGE
            // ---------------------------------------------------------------------

            if (packagePurchase) {
              const firstReservation =
                insertedReservations[0];

              if (!firstReservation) {
                throw new Error(
                  "Could not determine the first reservation for package usage.",
                );
              }

              const idempotencyKey =
                `meeting-room-usage:${packagePurchase.id}:${firstReservation.id}`;

              await tx
                .insert(
                  meetingRoomPackageUsageLedger,
                )
                .values({
                  packagePurchaseId:
                    packagePurchase.id,

                  reservationId:
                    firstReservation.id,

                  userId:
                    user.id,

                  entryType:
                    "usage",

                  hoursDelta:
                    `-${packageHoursRequired.toFixed(
                      2,
                    )}`,

                  reason:
                    `Meeting room reservation #${firstReservation.id} (${occurrences.length} occurrence(s))`,

                  idempotencyKey,
                });

              const remainingHours =
                Math.round(
                  (
                    packageBalance -
                    packageHoursRequired
                  ) *
                    100,
                ) / 100;

              if (
                remainingHours <= 0
              ) {
                await tx
                  .update(
                    customerMeetingRoomPackages,
                  )
                  .set({
                    status:
                      "exhausted",

                    updatedAt:
                      new Date(),
                  })
                  .where(
                    eq(
                      customerMeetingRoomPackages.id,
                      packagePurchase.id,
                    ),
                  );
              }
            }

            // ---------------------------------------------------------------------
            // AUDIT
            // ---------------------------------------------------------------------

            const firstReservation =
              insertedReservations[0];

            await tx
              .insert(auditLogs)
              .values({
                userId:
                  user.id,

                action:
                  "meeting_room_reservation_created",

                entityType:
                  "meeting_room_reservation",

                entityId:
                  firstReservation?.id ??
                  null,

                details: {
                  roomId:
                    lockedRoom.id,

                  roomName:
                    lockedRoom.name,

                  customerId:
                    customer.id,

                  attendeeCount,

                  durationHours,

                  recurrence,

                  recurrenceCount,

                  reservationCount:
                    insertedReservations.length,

                  packagePurchaseId:
                    packagePurchaseId ??
                    null,

                  packageHoursUsed:
                    packagePurchase
                      ? packageHoursRequired
                      : 0,

                  hourlyRate:
                    finalHourlyRate,

                  subtotalAmount:
                    totalSubtotal.toFixed(
                      2,
                    ),

                  discountPercent:
                    packagePurchase
                      ? packageDiscountPercent
                      : 0,

                  discountAmount:
                    totalDiscount.toFixed(
                      2,
                    ),

                  totalAmount:
                    totalAmount.toFixed(
                      2,
                    ),

                  googleEventIds:
                    createdGoogleEvents.map(
                      (event) =>
                        event.eventId,
                    ),
                },
              });

            return {
              customer,

              reservations:
                insertedReservations,

              totalSubtotal:
                totalSubtotal.toFixed(2),

              totalDiscount:
                totalDiscount.toFixed(2),

              totalAmount:
                totalAmount.toFixed(2),

              discountPercent:
                packagePurchase
                  ? packageDiscountPercent
                  : 0,

              packageHoursUsed:
                packagePurchase
                  ? packageHoursRequired.toFixed(
                      2,
                    )
                  : null,

              packageRemainingHours:
                packagePurchase
                  ? Math.max(
                      0,
                      Math.round(
                        (
                          packageBalance -
                          packageHoursRequired
                        ) *
                          100,
                      ) / 100,
                    ).toFixed(2)
                  : null,

              hourlyRate:
                finalHourlyRate,
            };
          },
        );

      // ---------------------------------------------------------------------------
      // SUCCESS
      // ---------------------------------------------------------------------------

      return NextResponse.json(
        {
          ok: true,

          room: {
            id: room.id,
            name: room.name,
            capacity: room.capacity,
          },

          customer: {
            id:
              transactionResult.customer.id,

            name:
              transactionResult.customer.name,

            phone:
              transactionResult.customer.phone,
          },

          reservationIds:
            transactionResult.reservations.map(
              (reservation) =>
                reservation.id,
            ),

          reservations:
            transactionResult.reservations.map(
              (
                reservation,
                index,
              ) => ({
                id:
                  reservation.id,

                startAt:
                  reservation.startAt.toISOString(),

                endAt:
                  reservation.endAt.toISOString(),

                googleEventId:
                  createdGoogleEvents[
                    index
                  ]?.eventId ?? null,
              }),
            ),

          recurrence,

          recurrenceCount,

          attendeeCount,

          durationHours,

          billing: {
            hourlyRate:
              transactionResult.hourlyRate,

            subtotalAmount:
              transactionResult.totalSubtotal,

            discountPercent:
              transactionResult.discountPercent,

            discountAmount:
              transactionResult.totalDiscount,

            totalAmount:
              transactionResult.totalAmount,

            packagePurchaseId:
              packagePurchaseId ??
              null,

            packageHoursUsed:
              transactionResult.packageHoursUsed,

            packageRemainingHours:
              transactionResult.packageRemainingHours,
          },

          calendar: {
            calendarId:
              mapping.calendarId,

            calendarName:
              mapping.calendarName ??
              null,
          },

          startAt:
            start.toISOString(),

          endAt:
            end.toISOString(),
        },
        {
          status: 201,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    } catch (databaseError) {
      console.error(
        "[Meeting Room] Database transaction failed:",
        databaseError,
      );

      await rollbackGoogleEvents();

      const message =
        getSafeErrorMessage(
          databaseError,
          "Could not create the meeting room reservation.",
        );

      return NextResponse.json(
        {
          error: isConflictError(message)
            ? message
            : "Could not create the meeting room reservation.",
        },
        {
          status:
            isConflictError(message)
              ? 409
              : 500,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }
  } catch (error) {
    console.error(
      "[Meeting Room] Create reservation error:",
      error,
    );

    await rollbackGoogleEvents();

    return NextResponse.json(
      {
        error:
          error instanceof Error &&
          (
            error.message.includes(
              "Customer",
            ) ||
            error.message.includes(
              "package",
            ) ||
            error.message.includes(
              "Package",
            ) ||
            error.message.includes(
              "capacity",
            )
          )
            ? error.message
            : "Could not create meeting room reservation.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}