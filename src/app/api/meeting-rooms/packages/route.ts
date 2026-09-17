import { NextResponse } from "next/server";
import {
  and,
  desc,
  eq,
  sql,
} from "drizzle-orm";

import { db } from "@/db";

import {
  meetingRoomPackages,
} from "@/db/schema";

import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";

import {
  getMeetingRoomPackageDiscountPercent,
  validateMeetingRoomPackageDefinition,
} from "@/lib/meeting-room-billing";

export const dynamic = "force-dynamic";

/* ============================================================================
 * TYPES
 * ========================================================================== */

type CreatePackageBody = {
  name?: unknown;
  totalHours?: unknown;
  discountPercent?: unknown;
  price?: unknown;
  validityDays?: unknown;
  description?: unknown;
};

type UpdatePackageBody = CreatePackageBody & {
  id?: unknown;
  status?: unknown;
};

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const PACKAGE_DEFINITIONS_LOCK_KEY =
  "workspacehub:meeting-room-package-definitions";

/* ============================================================================
 * HELPERS
 * ========================================================================== */

function parsePositiveSafeInteger(
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

function parsePositiveNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed <= 0
  ) {
    return null;
  }

  return parsed;
}

function parseOptionalPositiveInteger(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  return parsePositiveSafeInteger(value);
}

function normalizeOptionalText(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value).trim();

  return text || null;
}

function isValidStatus(
  value: unknown,
): value is "active" | "inactive" {
  return (
    value === "active" ||
    value === "inactive"
  );
}

function serializePackage(pkg: typeof meetingRoomPackages.$inferSelect) {
  return {
    ...pkg,
    createdAt:
      pkg.createdAt.toISOString(),
    updatedAt:
      pkg.updatedAt.toISOString(),
  };
}

function isPgUniqueViolation(
  error: unknown,
): boolean {
  if (
    !error ||
    typeof error !== "object"
  ) {
    return false;
  }

  const candidate =
    error as {
      code?: unknown;
    };

  return candidate.code === "23505";
}

async function acquirePackageDefinitionsLock(
  tx: Parameters<
    Parameters<typeof db.transaction>[0]
  >[0],
) {
  await tx.execute(
    sql`
      SELECT pg_advisory_xact_lock(
        hashtext(${PACKAGE_DEFINITIONS_LOCK_KEY})
      )
    `,
  );
}

/* ============================================================================
 * AUTH
 * ========================================================================== */

async function requireManager() {
  const user =
    await getCurrentUser();

  if (!user) {
    return {
      response:
        NextResponse.json(
          {
            error:
              "Unauthorized",
          },
          {
            status: 401,
          },
        ),
    };
  }

  if (
    !canManage(
      user.role,
    )
  ) {
    return {
      response:
        NextResponse.json(
          {
            error:
              "Permission denied.",
          },
          {
            status: 403,
          },
        ),
    };
  }

  return {
    user,
  };
}

/* ============================================================================
 * BUSINESS VALIDATION
 * ========================================================================== */

function getRequiredDiscount(
  totalHours: number,
): number {
  return getMeetingRoomPackageDiscountPercent(
    totalHours,
  );
}

function validatePackageDefinition(
  params: {
    totalHours: number;
    discountPercent: number;
    price: number;
  },
): void {
  validateMeetingRoomPackageDefinition(
    params,
  );
}

/* ============================================================================
 * GET
 *
 * Returns all meeting-room package definitions.
 * Manager-only.
 * ========================================================================== */

export async function GET() {
  try {
    const auth =
      await requireManager();

    if ("response" in auth) {
      return auth.response;
    }

    const packages =
      await db
        .select({
          id:
            meetingRoomPackages.id,

          name:
            meetingRoomPackages.name,

          totalHours:
            meetingRoomPackages.totalHours,

          discountPercent:
            meetingRoomPackages.discountPercent,

          price:
            meetingRoomPackages.price,

          validityDays:
            meetingRoomPackages.validityDays,

          description:
            meetingRoomPackages.description,

          status:
            meetingRoomPackages.status,

          createdAt:
            meetingRoomPackages.createdAt,

          updatedAt:
            meetingRoomPackages.updatedAt,
        })
        .from(
          meetingRoomPackages,
        )
        .orderBy(
          desc(
            meetingRoomPackages.totalHours,
          ),
          desc(
            meetingRoomPackages.id,
          ),
        );

    return NextResponse.json({
      ok: true,

      packages:
        packages.map(
          (pkg) => ({
            ...pkg,

            createdAt:
              pkg.createdAt.toISOString(),

            updatedAt:
              pkg.updatedAt.toISOString(),
          }),
        ),
    });
  } catch (error) {
    console.error(
      "Get meeting room packages error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load meeting room packages.",
      },
      {
        status: 500,
      },
    );
  }
}

/* ============================================================================
 * POST
 *
 * Create a package definition.
 * ========================================================================== */

export async function POST(
  req: Request,
) {
  try {
    const auth =
      await requireManager();

    if ("response" in auth) {
      return auth.response;
    }

    const user =
      auth.user;

    const body =
      (
        await req
          .json()
          .catch(() => null)
      ) as CreatePackageBody | null;

    if (!body) {
      return NextResponse.json(
        {
          error:
            "Invalid request body.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * NAME
     * ---------------------------------------------------------------------- */

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    if (name.length < 2) {
      return NextResponse.json(
        {
          error:
            "Package name is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (name.length > 200) {
      return NextResponse.json(
        {
          error:
            "Package name is too long.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * HOURS
     * ---------------------------------------------------------------------- */

    const totalHours =
      parsePositiveNumber(
        body.totalHours,
      );

    if (totalHours === null) {
      return NextResponse.json(
        {
          error:
            "Package hours must be greater than zero.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * DISCOUNT
     *
     * Never trust the client.
     * ---------------------------------------------------------------------- */

    let requiredDiscount: number;

    try {
      requiredDiscount =
        getRequiredDiscount(
          totalHours,
        );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid meeting room package hours.",
        },
        {
          status: 400,
        },
      );
    }

    const suppliedDiscount =
      parsePositiveNumber(
        body.discountPercent,
      );

    if (
      suppliedDiscount === null
    ) {
      return NextResponse.json(
        {
          error:
            "Discount percent is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      suppliedDiscount !==
      requiredDiscount
    ) {
      return NextResponse.json(
        {
          error:
            `A ${totalHours}-hour meeting room package must use a ${requiredDiscount}% discount.`,
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * PRICE
     * ---------------------------------------------------------------------- */

    const price =
      parsePositiveNumber(
        body.price,
      );

    if (price === null) {
      return NextResponse.json(
        {
          error:
            "Package price must be greater than zero.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * VALIDITY
     * ---------------------------------------------------------------------- */

    const validityDays =
      body.validityDays ===
        null ||
      body.validityDays ===
        undefined ||
      body.validityDays ===
        ""
        ? null
        : parsePositiveSafeInteger(
            body.validityDays,
          );

    if (
      body.validityDays !== null &&
      body.validityDays !== undefined &&
      body.validityDays !== "" &&
      validityDays === null
    ) {
      return NextResponse.json(
        {
          error:
            "Validity days must be a positive whole number.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * DESCRIPTION
     * ---------------------------------------------------------------------- */

    const description =
      normalizeOptionalText(
        body.description,
      );

    /* ------------------------------------------------------------------------
     * BUSINESS VALIDATION
     * ---------------------------------------------------------------------- */

    try {
      validatePackageDefinition({
        totalHours,
        discountPercent:
          requiredDiscount,
        price,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid meeting room package.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * TRANSACTION + ADVISORY LOCK
     *
     * This prevents concurrent POST/PATCH requests from creating or activating
     * duplicate package definitions for the same package size.
     * ---------------------------------------------------------------------- */

    try {
      const created =
        await db.transaction(
          async (tx) => {
            await acquirePackageDefinitionsLock(
              tx,
            );

            const [existing] =
              await tx
                .select({
                  id:
                    meetingRoomPackages.id,
                  name:
                    meetingRoomPackages.name,
                  status:
                    meetingRoomPackages.status,
                })
                .from(
                  meetingRoomPackages,
                )
                .where(
                  eq(
                    meetingRoomPackages.totalHours,
                    totalHours.toFixed(2),
                  ),
                )
                .limit(1);

            if (existing) {
              throw new Error(
                `DUPLICATE:${existing.id}:${existing.status}`,
              );
            }

            const [inserted] =
              await tx
                .insert(
                  meetingRoomPackages,
                )
                .values({
                  name,

                  totalHours:
                    totalHours.toFixed(2),

                  discountPercent:
                    requiredDiscount.toFixed(
                      2,
                    ),

                  price:
                    price.toFixed(2),

                  validityDays,

                  description,

                  status:
                    "active",
                })
                .returning();

            if (!inserted) {
              throw new Error(
                "Could not create meeting room package.",
              );
            }

            return inserted;
          },
        );

      return NextResponse.json(
        {
          ok: true,

          package: {
            ...serializePackage(
              created,
            ),

            createdBy:
              user.id,
          },
        },
        {
          status: 201,
        },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith(
          "DUPLICATE:",
        )
      ) {
        return NextResponse.json(
          {
            error:
              `A ${totalHours}-hour meeting room package already exists.`,
          },
          {
            status: 409,
          },
        );
      }

      if (
        isPgUniqueViolation(
          error,
        )
      ) {
        return NextResponse.json(
          {
            error:
              "A meeting room package with the same definition already exists.",
          },
          {
            status: 409,
          },
        );
      }

      throw error;
    }
  } catch (error) {
    console.error(
      "Create meeting room package error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not create meeting room package.",
      },
      {
        status: 500,
      },
    );
  }
}

/* ============================================================================
 * PATCH
 *
 * Update a package definition.
 *
 * Existing customer purchases remain unchanged because their purchase records
 * use snapshot values.
 * ========================================================================== */

export async function PATCH(
  req: Request,
) {
  try {
    const auth =
      await requireManager();

    if ("response" in auth) {
      return auth.response;
    }

    const body =
      (
        await req
          .json()
          .catch(() => null)
      ) as UpdatePackageBody | null;

    if (!body) {
      return NextResponse.json(
        {
          error:
            "Invalid request body.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * PACKAGE ID
     * ---------------------------------------------------------------------- */

    const packageId =
      parsePositiveSafeInteger(
        body.id,
      );

    if (!packageId) {
      return NextResponse.json(
        {
          error:
            "A valid package id is required.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * TRANSACTION + ADVISORY LOCK
     * ---------------------------------------------------------------------- */

    try {
      const updated =
        await db.transaction(
          async (tx) => {
            await acquirePackageDefinitionsLock(
              tx,
            );

            /* ------------------------------------------------------------------
             * LOAD CURRENT PACKAGE
             * ---------------------------------------------------------------- */

            const [current] =
              await tx
                .select()
                .from(
                  meetingRoomPackages,
                )
                .where(
                  eq(
                    meetingRoomPackages.id,
                    packageId,
                  ),
                )
                .limit(1);

            if (!current) {
              throw new Error(
                "PACKAGE_NOT_FOUND",
              );
            }

            /* ------------------------------------------------------------------
             * NAME
             * ---------------------------------------------------------------- */

            const name =
              body.name !==
              undefined
                ? typeof body.name ===
                    "string"
                  ? body.name.trim()
                  : ""
                : current.name;

            if (name.length < 2) {
              throw new Error(
                "Package name is required.",
              );
            }

            if (name.length > 200) {
              throw new Error(
                "Package name is too long.",
              );
            }

            /* ------------------------------------------------------------------
             * HOURS
             * ---------------------------------------------------------------- */

            const totalHours =
              body.totalHours !==
              undefined
                ? parsePositiveNumber(
                    body.totalHours,
                  )
                : Number(
                    current.totalHours,
                  );

            if (
              totalHours === null
            ) {
              throw new Error(
                "Package hours must be greater than zero.",
              );
            }

            /* ------------------------------------------------------------------
             * REQUIRED DISCOUNT
             * ---------------------------------------------------------------- */

            let requiredDiscount: number;

            try {
              requiredDiscount =
                getRequiredDiscount(
                  totalHours,
                );
            } catch (error) {
              throw new Error(
                error instanceof Error
                  ? error.message
                  : "Invalid meeting room package hours.",
              );
            }

            /* ------------------------------------------------------------------
             * PRICE
             * ---------------------------------------------------------------- */

            const price =
              body.price !==
              undefined
                ? parsePositiveNumber(
                    body.price,
                  )
                : Number(
                    current.price,
                  );

            if (price === null) {
              throw new Error(
                "Package price must be greater than zero.",
              );
            }

            /* ------------------------------------------------------------------
             * VALIDITY
             * ---------------------------------------------------------------- */

            let validityDays =
              current.validityDays;

            if (
              body.validityDays !==
              undefined
            ) {
              validityDays =
                body.validityDays ===
                  null ||
                body.validityDays ===
                  ""
                  ? null
                  : parsePositiveSafeInteger(
                      body.validityDays,
                    );

              if (
                body.validityDays !==
                  null &&
                body.validityDays !==
                  "" &&
                validityDays === null
              ) {
                throw new Error(
                  "Validity days must be a positive whole number.",
                );
              }
            }

            /* ------------------------------------------------------------------
             * STATUS
             * ---------------------------------------------------------------- */

            const status =
              body.status !==
              undefined
                ? body.status
                : current.status;

            if (
              !isValidStatus(
                status,
              )
            ) {
              throw new Error(
                "Invalid package status.",
              );
            }

            /* ------------------------------------------------------------------
             * DESCRIPTION
             * ---------------------------------------------------------------- */

            const description =
              body.description !==
              undefined
                ? normalizeOptionalText(
                    body.description,
                  )
                : current.description;

            /* ------------------------------------------------------------------
             * BUSINESS VALIDATION
             * ---------------------------------------------------------------- */

            try {
              validatePackageDefinition({
                totalHours,
                discountPercent:
                  requiredDiscount,
                price,
              });
            } catch (error) {
              throw new Error(
                error instanceof Error
                  ? error.message
                  : "Invalid meeting room package.",
              );
            }

            /* ------------------------------------------------------------------
             * DUPLICATE HOURS
             *
             * Only another ACTIVE package blocks activation/change.
             * ---------------------------------------------------------------- */

            const [duplicate] =
              await tx
                .select({
                  id:
                    meetingRoomPackages.id,
                })
                .from(
                  meetingRoomPackages,
                )
                .where(
                  and(
                    eq(
                      meetingRoomPackages.totalHours,
                      totalHours.toFixed(
                        2,
                      ),
                    ),
                    eq(
                      meetingRoomPackages.status,
                      "active",
                    ),
                  ),
                )
                .limit(1);

            if (
              duplicate &&
              duplicate.id !==
                packageId &&
              status === "active"
            ) {
              throw new Error(
                `DUPLICATE_ACTIVE:${totalHours}`,
              );
            }

            /* ------------------------------------------------------------------
             * UPDATE
             * ---------------------------------------------------------------- */

            const [result] =
              await tx
                .update(
                  meetingRoomPackages,
                )
                .set({
                  name,

                  totalHours:
                    totalHours.toFixed(
                      2,
                    ),

                  discountPercent:
                    requiredDiscount.toFixed(
                      2,
                    ),

                  price:
                    price.toFixed(
                      2,
                    ),

                  validityDays,

                  description,

                  status,

                  updatedAt:
                    new Date(),
                })
                .where(
                  eq(
                    meetingRoomPackages.id,
                    packageId,
                  ),
                )
                .returning();

            if (!result) {
              throw new Error(
                "Could not update meeting room package.",
              );
            }

            return result;
          },
        );

      return NextResponse.json({
        ok: true,

        package:
          serializePackage(
            updated,
          ),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          "PACKAGE_NOT_FOUND"
      ) {
        return NextResponse.json(
          {
            error:
              "Meeting room package not found.",
          },
          {
            status: 404,
          },
        );
      }

      if (
        error instanceof Error &&
        error.message.startsWith(
          "DUPLICATE_ACTIVE:",
        )
      ) {
        const hours =
          error.message.split(
            ":",
          )[1];

        return NextResponse.json(
          {
            error:
              `Another active ${hours}-hour meeting room package already exists.`,
          },
          {
            status: 409,
          },
        );
      }

      if (
        isPgUniqueViolation(
          error,
        )
      ) {
        return NextResponse.json(
          {
            error:
              "A meeting room package with the same definition already exists.",
          },
          {
            status: 409,
          },
        );
      }

      if (
        error instanceof Error
      ) {
        const knownErrors = [
          "Package name is required.",
          "Package name is too long.",
          "Package hours must be greater than zero.",
          "Package price must be greater than zero.",
          "Validity days must be a positive whole number.",
          "Invalid package status.",
        ];

        if (
          knownErrors.includes(
            error.message,
          )
        ) {
          return NextResponse.json(
            {
              error:
                error.message,
            },
            {
              status: 400,
            },
          );
        }

        return NextResponse.json(
          {
            error:
              error.message ||
              "Could not update meeting room package.",
          },
          {
            status: 400,
          },
        );
      }

      throw error;
    }
  } catch (error) {
    console.error(
      "Update meeting room package error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not update meeting room package.",
      },
      {
        status: 500,
      },
    );
  }
}