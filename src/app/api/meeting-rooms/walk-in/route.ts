import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  and,
  eq,
  gt,
  lt,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  auditLogs,
  bookings,
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
  getActiveShiftForUser,
} from "@/lib/shift";

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

export const dynamic =
  "force-dynamic";

type Body = {
  deskId?: number | string;
  customerId?: number | string | null;
  customerName?: string;
  customerPhone?: string;
  attendeeCount?: number | string;
  durationHours?: number | string;
  packagePurchaseId?: number | string | null;
  notes?: string | null;
};

const HOUR_MS =
  60 * 60 * 1000;

function generateAccessCode(): string {
  return String(
    crypto.randomInt(0, 10000),
  ).padStart(4, "0");
}

function generateAccessToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashAccessToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function parsePositiveInteger(
  value: unknown,
): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : Number(value);

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
  const digits =
    value.replace(/\D/g, "");

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

async function findInternalConflict(
  roomId: number,
  start: Date,
  end: Date,
) {
  const rows =
    await db
      .select({
        id:
          meetingRoomReservations.id,
        startAt:
          meetingRoomReservations.startAt,
        endAt:
          meetingRoomReservations.endAt,
        status:
          meetingRoomReservations.status,
      })
      .from(
        meetingRoomReservations,
      )
      .where(
        and(
          eq(
            meetingRoomReservations.deskId,
            roomId,
          ),
          or(
            eq(
              meetingRoomReservations.status,
              "confirmed",
            ),
            eq(
              meetingRoomReservations.status,
              "active",
            ),
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

export async function POST(
  req: Request,
) {
  const createdGoogleEvents: Array<{
    calendarId: string;
    eventId: string;
  }> = [];

  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    if (!canManage(user.role)) {
      return NextResponse.json(
        {
          error:
            "Only managers/admins can start meeting-room sessions.",
        },
        { status: 403 },
      );
    }

    const activeShift =
      await getActiveShiftForUser(
        user.id,
      );

    if (!activeShift) {
      return NextResponse.json(
        {
          error:
            "Open a shift before starting a meeting-room session.",
        },
        { status: 400 },
      );
    }

    const body =
      (await req
        .json()
        .catch(() => null)) as Body | null;

    if (!body) {
      return NextResponse.json(
        {
          error:
            "Invalid request body.",
        },
        { status: 400 },
      );
    }

    const deskId =
      parsePositiveInteger(
        body.deskId,
      );

    const attendeeCount =
      parsePositiveInteger(
        body.attendeeCount,
      );

    const durationHours =
      parsePositiveInteger(
        body.durationHours,
      );

    if (!deskId) {
      return NextResponse.json(
        {
          error:
            "A valid meeting room is required.",
        },
        { status: 400 },
      );
    }

    if (!attendeeCount) {
      return NextResponse.json(
        {
          error:
            "A valid attendee count is required.",
        },
        { status: 400 },
      );
    }

    if (!durationHours) {
      return NextResponse.json(
        {
          error:
            "A valid duration in whole hours is required.",
        },
        { status: 400 },
      );
    }

    try {
      validateMeetingRoomDuration(
        durationHours,
      );
    } catch (validationError) {
      return NextResponse.json(
        {
          error:
            validationError instanceof Error
              ? validationError.message
              : "Invalid meeting room duration.",
        },
        { status: 400 },
      );
    }

    const startAt =
      new Date();

    startAt.setSeconds(
      0,
      0,
    );

    const endAt =
      new Date(
        startAt.getTime() +
          durationHours *
            HOUR_MS,
      );

    const [
      room,
    ] =
      await db
        .select({
          id: desks.id,
          name: desks.name,
          type: desks.type,
          active: desks.active,
          capacity: desks.capacity,
          hourlyRate:
            desks.hourlyRate,
        })
        .from(desks)
        .where(
          and(
            eq(
              desks.id,
              deskId,
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

    if (!room) {
      return NextResponse.json(
        {
          error:
            "Meeting room not found or inactive.",
        },
        { status: 404 },
      );
    }

    try {
      validateAttendeeCount(
        attendeeCount,
        room.capacity,
      );
    } catch (validationError) {
      return NextResponse.json(
        {
          error:
            validationError instanceof Error
              ? validationError.message
              : "Invalid attendee count.",
        },
        { status: 400 },
      );
    }

    const rawName =
      body.customerName?.trim() ??
      "";

    const rawPhone =
      body.customerPhone?.trim() ??
      "";

    if (!rawName) {
      return NextResponse.json(
        {
          error:
            "Customer name is required.",
        },
        { status: 400 },
      );
    }

    if (!rawPhone) {
      return NextResponse.json(
        {
          error:
            "Customer phone is required.",
        },
        { status: 400 },
      );
    }

    const normalizedPhone =
      normalizePhone(rawPhone);

    if (!normalizedPhone) {
      return NextResponse.json(
        {
          error:
            "Customer phone is invalid.",
        },
        { status: 400 },
      );
    }

    const suppliedCustomerId =
      body.customerId !==
        undefined &&
      body.customerId !== null
        ? parsePositiveInteger(
            body.customerId,
          )
        : null;

    const packagePurchaseId =
      body.packagePurchaseId !==
        undefined &&
      body.packagePurchaseId !== null &&
      body.packagePurchaseId !== ""
        ? parsePositiveInteger(
            body.packagePurchaseId,
          )
        : null;

    if (
      body.packagePurchaseId !==
        undefined &&
      body.packagePurchaseId !==
        null &&
      body.packagePurchaseId !== "" &&
      !packagePurchaseId
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid meeting room package purchase ID.",
        },
        { status: 400 },
      );
    }

    const existingConflict =
      await findInternalConflict(
        room.id,
        startAt,
        endAt,
      );

    if (existingConflict) {
      return NextResponse.json(
        {
          error:
            "This meeting room is already occupied for the requested duration.",
          conflictingStart:
            existingConflict.startAt.toISOString(),
          conflictingEnd:
            existingConflict.endAt.toISOString(),
          status:
            existingConflict.status,
        },
        { status: 409 },
      );
    }

    const [
      mapping,
    ] =
      await db
        .select({
          calendarId:
            meetingRoomCalendars.calendarId,
          calendarName:
            meetingRoomCalendars.calendarName,
        })
        .from(
          meetingRoomCalendars,
        )
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
        { status: 400 },
      );
    }

    const googleBusy =
      await getCalendarBusyPeriods(
        mapping.calendarId,
        startAt.toISOString(),
        endAt.toISOString(),
      );

    if (
      googleBusy.length > 0
    ) {
      return NextResponse.json(
        {
          error:
            "The meeting room is already busy in Google Calendar for the requested duration.",
          conflictingStart:
            googleBusy[0]?.start ??
            startAt.toISOString(),
          conflictingEnd:
            googleBusy[0]?.end ??
            endAt.toISOString(),
          busy: googleBusy,
        },
        { status: 409 },
      );
    }

    let customerDisplayName =
      rawName;

    if (suppliedCustomerId) {
      const existing =
        await db
          .select({
            id:
              customers.id,
            name:
              customers.name,
            phone:
              customers.phone,
          })
          .from(customers)
          .where(
            eq(
              customers.id,
              suppliedCustomerId,
            ),
          )
          .limit(1);

      if (!existing[0]) {
        return NextResponse.json(
          {
            error:
              "The selected customer does not exist.",
          },
          { status: 404 },
        );
      }

      customerDisplayName =
        existing[0].name;
    }

    if (packagePurchaseId) {
      const packageRows =
        await db
          .select({
            id:
              customerMeetingRoomPackages.id,
            customerId:
              customerMeetingRoomPackages.customerId,
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

      const purchase =
        packageRows[0];

      if (!purchase) {
        return NextResponse.json(
          {
            error:
              "Meeting room package purchase not found.",
          },
          { status: 404 },
        );
      }

      if (
        purchase.status !==
        "active"
      ) {
        return NextResponse.json(
          {
            error:
              "This meeting room package is not active.",
          },
          { status: 400 },
        );
      }

      if (
        purchase.expiresAt &&
        purchase.expiresAt.getTime() <=
          Date.now()
      ) {
        return NextResponse.json(
          {
            error:
              "This meeting room package has expired.",
          },
          { status: 400 },
        );
      }
    }

    let billingPreview;

    try {
      billingPreview =
        await calculateMeetingRoomBooking({
          deskId:
            room.id,
          attendeeCount,
          durationHours,
        });
    } catch (billingError) {
      return NextResponse.json(
        {
          error:
            billingError instanceof Error
              ? billingError.message
              : "Could not calculate meeting room price.",
        },
        { status: 400 },
      );
    }

    const baseSubtotal =
      Number(
        billingPreview.subtotalAmount,
      );

    let previewDiscountPercent =
      0;

    if (packagePurchaseId) {
      const packageRows =
        await db
          .select({
            customerId:
              customerMeetingRoomPackages.customerId,
            discountPercentSnapshot:
              customerMeetingRoomPackages.discountPercentSnapshot,
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

      const purchase =
        packageRows[0];

      if (!purchase) {
        return NextResponse.json(
          {
            error:
              "Meeting room package purchase not found.",
          },
          { status: 404 },
        );
      }

      previewDiscountPercent =
        Number(
          purchase.discountPercentSnapshot,
        );

      if (
        !Number.isFinite(
          previewDiscountPercent,
        ) ||
        previewDiscountPercent < 0 ||
        previewDiscountPercent > 100
      ) {
        return NextResponse.json(
          {
            error:
              "Invalid meeting room package discount.",
          },
          { status: 400 },
        );
      }
    }

    const previewDiscountAmount =
      Math.round(
        baseSubtotal *
          (previewDiscountPercent / 100) *
          100,
      ) / 100;

    const previewTotalAmount =
      Math.round(
        (baseSubtotal -
          previewDiscountAmount) *
          100,
      ) / 100;

    try {
      const googleResult =
        await createGoogleCalendarEvent(
          mapping.calendarId,
          {
            summary:
              `Meeting Room - ${room.name} — Walk-in`,
            description:
              [
                `Customer: ${customerDisplayName}`,
                `Attendees: ${attendeeCount}`,
                `Duration: ${durationHours} hour(s)`,
                packagePurchaseId
                  ? "Billing: Meeting Room Package"
                  : "Billing: Regular Walk-in",
                body.notes?.trim()
                  ? `Notes: ${body.notes.trim()}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
            start:
              startAt.toISOString(),
            end:
              endAt.toISOString(),
          },
        );

      if (!googleResult.id) {
        throw new Error(
          "Google Calendar created the event but did not return an event ID.",
        );
      }

      createdGoogleEvents.push({
        calendarId:
          mapping.calendarId,
        eventId:
          googleResult.id,
      });
    } catch (googleError) {
      return NextResponse.json(
        {
          error:
            googleError instanceof Error
              ? `Google Calendar session start failed: ${googleError.message}`
              : "Google Calendar session start failed.",
        },
        { status: 502 },
      );
    }

    try {
      const result =
        await db.transaction(
          async (tx) => {
            await tx.execute(
              sql`
                SELECT pg_advisory_xact_lock(
                  29001,
                  ${room.id}
                )
              `,
            );

            const [
              lockedRoom,
            ] =
              await tx
                .select({
                  id:
                    desks.id,
                  name:
                    desks.name,
                  capacity:
                    desks.capacity,
                  active:
                    desks.active,
                  type:
                    desks.type,
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

            const internalConflict =
              await tx
                .select({
                  id:
                    meetingRoomReservations.id,
                  startAt:
                    meetingRoomReservations.startAt,
                  endAt:
                    meetingRoomReservations.endAt,
                })
                .from(
                  meetingRoomReservations,
                )
                .where(
                  and(
                    eq(
                      meetingRoomReservations.deskId,
                      lockedRoom.id,
                    ),
                    or(
                      eq(
                        meetingRoomReservations.status,
                        "confirmed",
                      ),
                      eq(
                        meetingRoomReservations.status,
                        "active",
                      ),
                    ),
                    lt(
                      meetingRoomReservations.startAt,
                      endAt,
                    ),
                    gt(
                      meetingRoomReservations.endAt,
                      startAt,
                    ),
                  ),
                )
                .limit(1);

            if (internalConflict[0]) {
              throw new Error(
                "The meeting room was occupied by another request while this session was starting.",
              );
            }

            let customer:
              | {
                  id: number;
                  name: string;
                  phone: string;
                }
              | undefined;

            if (suppliedCustomerId) {
              const rows =
                await tx
                  .select({
                    id:
                      customers.id,
                    name:
                      customers.name,
                    phone:
                      customers.phone,
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
                rows[0];

              if (!customer) {
                throw new Error(
                  "The selected customer no longer exists.",
                );
              }
            } else {
              const existingRows =
                await tx
                  .select({
                    id:
                      customers.id,
                    name:
                      customers.name,
                    phone:
                      customers.phone,
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
                try {
                  const inserted =
                    await tx
                      .insert(customers)
                      .values({
                        name:
                          rawName,
                        phone:
                          rawPhone,
                        phoneNormalized:
                          normalizedPhone,
                      })
                      .returning({
                        id:
                          customers.id,
                        name:
                          customers.name,
                        phone:
                          customers.phone,
                      });

                  customer =
                    inserted[0];
                } catch (insertError) {
                  const concurrent =
                    await tx
                      .select({
                        id:
                          customers.id,
                        name:
                          customers.name,
                        phone:
                          customers.phone,
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
                    concurrent[0];

                  if (!customer) {
                    throw insertError;
                  }
                }
              }
            }

            if (!customer) {
              throw new Error(
                "Could not resolve the customer.",
              );
            }

            let packageBalance = 0;
            let packageDiscountPercent =
              0;

            if (packagePurchaseId) {
              const packageLock =
                await tx.execute(
                  sql`
                    SELECT id
                    FROM customer_meeting_room_packages
                    WHERE id = ${packagePurchaseId}
                    FOR UPDATE
                  `,
                );

              if (
                packageLock.rows.length ===
                0
              ) {
                throw new Error(
                  "Meeting room package purchase not found.",
                );
              }

              const [
                purchase,
              ] =
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
                purchase.expiresAt.getTime() <=
                  Date.now()
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
                    sum,
                    ledger,
                  ) => {
                    const hours =
                      Number(
                        ledger.hoursDelta,
                      );

                    return Number.isFinite(
                      hours,
                    )
                      ? sum + hours
                      : sum;
                  },
                  0,
                );

              packageBalance =
                Math.round(
                  packageBalance * 100,
                ) / 100;

              if (
                packageBalance <
                durationHours
              ) {
                throw new Error(
                  `Insufficient meeting room package balance. Remaining: ${packageBalance} hours, required: ${durationHours} hours.`,
                );
              }

              if (
                !Number.isFinite(
                  packageDiscountPercent,
                ) ||
                packageDiscountPercent < 0 ||
                packageDiscountPercent > 100
              ) {
                throw new Error(
                  "Invalid meeting room package discount.",
                );
              }
            }

            /* -------------------------------------------------------------- */
            /* CUSTOMER SESSION / QR ACCESS                                   */
            /* -------------------------------------------------------------- */

            let accessCode: string | null = null;

            for (let attempt = 0; attempt < 100; attempt += 1) {
              const candidate =
                generateAccessCode();

              const existingCode =
                await tx
                  .select({
                    id: bookings.id,
                  })
                  .from(bookings)
                  .where(
                    eq(
                      bookings.accessCode,
                      candidate,
                    ),
                  )
                  .limit(1);

              if (!existingCode[0]) {
                accessCode = candidate;
                break;
              }
            }

            if (!accessCode) {
              throw new Error(
                "Could not generate a unique customer access code.",
              );
            }

            const [createdBooking] =
              await tx
                .insert(bookings)
                .values({
                  customerId: customer.id,
                  deskId: lockedRoom.id,
                  shiftId: activeShift.id,
                  userId: user.id,
                  accessCode,
                  accessTokenHash: null,
                  accessTokenCreatedAt: null,
                  checkedInAt: startAt,
                  hourlyRateSnapshot: (
                    await calculateMeetingRoomBooking({
                      deskId: lockedRoom.id,
                      attendeeCount,
                      durationHours,
                    })
                  ).hourlyRate,
                  seatCharge: null,
                  ordersTotal: "0.00",
                  discount: "0.00",
                  total: null,
                  paidAmount: null,
                  changeAmount: null,
                  paymentMethod: null,
                  billingMode:
                    packagePurchaseId
                      ? "package"
                      : "regular",
                  subscriptionId: null,
                  subscriptionHoursUsed: null,
                  billingNote:
                    packagePurchaseId
                      ? `meeting_room_package:${packagePurchaseId}`
                      : `meeting_room_reservation`,
                  status: "active",
                })
                .returning({
                  id: bookings.id,
                  accessCode: bookings.accessCode,
                });

            if (!createdBooking) {
              throw new Error(
                "Could not create the customer session linked to this meeting room.",
              );
            }

            const finalSubtotal =
              Number(
                (
                  await calculateMeetingRoomBooking({
                    deskId:
                      lockedRoom.id,
                    attendeeCount,
                    durationHours,
                  })
                ).subtotalAmount,
              );

            const finalDiscount =
              packagePurchaseId
                ? Math.round(
                    finalSubtotal *
                      (packageDiscountPercent / 100) *
                      100,
                  ) / 100
                : 0;

            const finalTotal =
              Math.round(
                (finalSubtotal -
                  finalDiscount) *
                  100,
              ) / 100;

            const [
              reservation,
            ] =
              await tx
                .insert(
                  meetingRoomReservations,
                )
                .values({
                  deskId:
                    lockedRoom.id,
                  customerId:
                    customer.id,
                  bookingId:
                    createdBooking.id,
                  userId:
                    user.id,
                  startAt,
                  endAt,
                  attendeeCount,
                  hourlyRateSnapshot:
                    (
                      await calculateMeetingRoomBooking({
                        deskId:
                          lockedRoom.id,
                        attendeeCount,
                        durationHours,
                      })
                    ).hourlyRate,
                  durationHours:
                    durationHours.toFixed(2),
                  subtotalAmount:
                    finalSubtotal.toFixed(2),
                  discountPercentSnapshot:
                    packagePurchaseId
                      ? packageDiscountPercent.toFixed(2)
                      : "0.00",
                  discountAmount:
                    finalDiscount.toFixed(2),
                  totalAmount:
                    finalTotal.toFixed(2),
                  packagePurchaseId:
                    packagePurchaseId ??
                    null,
                  packageHoursUsed:
                    packagePurchaseId
                      ? durationHours.toFixed(2)
                      : null,
                  recurrenceRule:
                    null,
                  recurrenceCount:
                    null,
                  googleEventId:
                    createdGoogleEvents[0]
                      .eventId,
                  status:
                    "active",
                  notes:
                    body.notes?.trim() ||
                    null,
                })
                .returning({
                  id:
                    meetingRoomReservations.id,
                  startAt:
                    meetingRoomReservations.startAt,
                  endAt:
                    meetingRoomReservations.endAt,
                });

            if (!reservation) {
              throw new Error(
                "Could not create the active meeting room session.",
              );
            }

            let packageRemainingHours:
              | string
              | null = null;

            if (packagePurchaseId) {
              const idempotencyKey =
                `meeting-room-walk-in-usage:${reservation.id}`;

              await tx
                .insert(
                  meetingRoomPackageUsageLedger,
                )
                .values({
                  packagePurchaseId,
                  reservationId:
                    reservation.id,
                  userId:
                    user.id,
                  entryType:
                    "usage",
                  hoursDelta:
                    `-${durationHours.toFixed(2)}`,
                  reason:
                    `Walk-in meeting room session #${reservation.id}`,
                  idempotencyKey,
                });

              const remaining =
                Math.round(
                  (packageBalance -
                    durationHours) *
                    100,
                ) / 100;

              packageRemainingHours =
                Math.max(
                  0,
                  remaining,
                ).toFixed(2);

              if (
                remaining <= 0
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
                      packagePurchaseId,
                    ),
                  );
              }
            }

            await tx
              .insert(auditLogs)
              .values({
                userId:
                  user.id,
                action:
                  "meeting_room_walk_in_started",
                entityType:
                  "meeting_room_reservation",
                entityId:
                  reservation.id,
                details: {
                  roomId:
                    lockedRoom.id,
                  roomName:
                    lockedRoom.name,
                  customerId:
                    customer.id,
                  bookingId:
                    createdBooking.id,
                  accessCode,
                  attendeeCount,
                  durationHours,
                  packagePurchaseId:
                    packagePurchaseId ??
                    null,
                  packageHoursUsed:
                    packagePurchaseId
                      ? durationHours
                      : 0,
                  hourlyRate:
                    finalSubtotal /
                    durationHours,
                  subtotalAmount:
                    finalSubtotal.toFixed(2),
                  discountPercent:
                    packagePurchaseId
                      ? packageDiscountPercent
                      : 0,
                  discountAmount:
                    finalDiscount.toFixed(2),
                  totalAmount:
                    finalTotal.toFixed(2),
                  googleEventId:
                    createdGoogleEvents[0]
                      .eventId,
                },
              });

            return {
              customer,
              booking: createdBooking,
              reservation,
              subtotalAmount:
                finalSubtotal.toFixed(2),
              discountPercent:
                packagePurchaseId
                  ? packageDiscountPercent.toFixed(2)
                  : "0.00",
              discountAmount:
                finalDiscount.toFixed(2),
              totalAmount:
                finalTotal.toFixed(2),
              hourlyRate:
                (
                  await calculateMeetingRoomBooking({
                    deskId:
                      lockedRoom.id,
                    attendeeCount,
                    durationHours,
                  })
                ).hourlyRate,
              packageRemainingHours,
            };
          },
        );

      return NextResponse.json(
        {
          ok: true,
          mode:
            "walk-in",
          reservation: {
            id:
              result.reservation.id,
            status:
              "active",
            startAt:
              result.reservation.startAt.toISOString(),
            endAt:
              result.reservation.endAt.toISOString(),
            googleEventId:
              createdGoogleEvents[0]
                .eventId,
          },
          booking: {
            id:
              result.booking.id,
            accessCode:
              result.booking.accessCode,
          },
          customer: result.customer,
          billing: {
            hourlyRate:
              result.hourlyRate,
            durationHours,
            attendeeCount,
            subtotalAmount:
              result.subtotalAmount,
            discountPercent:
              result.discountPercent,
            discountAmount:
              result.discountAmount,
            totalAmount:
              result.totalAmount,
            packagePurchaseId:
              packagePurchaseId ??
              null,
            packageHoursUsed:
              packagePurchaseId
                ? durationHours.toFixed(2)
                : null,
            packageRemainingHours:
              result.packageRemainingHours,
          },
          calendar: {
            calendarId:
              mapping.calendarId,
            calendarName:
              mapping.calendarName ??
              null,
          },
        },
        { status: 201 },
      );
    } catch (databaseError) {
      for (
        const created of createdGoogleEvents
      ) {
        try {
          await deleteGoogleCalendarEvent(
            created.calendarId,
            created.eventId,
          );
        } catch (cleanupError) {
          console.error(
            "Failed to rollback walk-in Google Calendar event:",
            {
              eventId:
                created.eventId,
              cleanupError,
            },
          );
        }
      }

      console.error(
        "Meeting room walk-in transaction failed:",
        databaseError,
      );

      return NextResponse.json(
        {
          error:
            databaseError instanceof Error
              ? databaseError.message
              : "Could not start meeting room session.",
        },
        { status: 500 },
      );
    }
  } catch (error) {
    for (
      const created of createdGoogleEvents
    ) {
      try {
        await deleteGoogleCalendarEvent(
          created.calendarId,
          created.eventId,
        );
      } catch (cleanupError) {
        console.error(
          "Failed to rollback walk-in Google Calendar event:",
          {
            eventId:
              created.eventId,
            cleanupError,
          },
        );
      }
    }

    console.error(
      "Start meeting room walk-in error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not start meeting room session.",
      },
      { status: 500 },
    );
  }
}
