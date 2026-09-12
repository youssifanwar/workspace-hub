import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  auditLogs,
  customerSubscriptions,
  subscriptionPackages,
} from "@/db/schema";

import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

// ============================================================================
// TYPES
// ============================================================================

type PackageBody = {
  name?: string;
  totalHours?: number | string;
  price?: number | string;
  validityDays?: number | string | null;
  description?: string | null;
  active?: boolean;
};

// ============================================================================
// HELPERS
// ============================================================================

function parsePositiveNumber(
  value: unknown,
): number | null {
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

function parseNonNegativeNumber(
  value: unknown,
): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    return null;
  }

  return parsed;
}

function parseValidityDays(
  value: unknown,
): number | null | "invalid" {
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
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    return "invalid";
  }

  return parsed;
}

function parseId(
  value: string,
): number | null {
  const id = Number(value);

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return null;
  }

  return id;
}

// ============================================================================
// GET ONE PACKAGE
// ============================================================================

export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    const { id: rawId } =
      await params;

    const id =
      parseId(rawId);

    if (!id) {
      return NextResponse.json(
        {
          error:
            "Invalid package ID.",
        },
        {
          status: 400,
        },
      );
    }

    const rows =
      await db
        .select({
          id:
            subscriptionPackages.id,

          name:
            subscriptionPackages.name,

          totalHours:
            subscriptionPackages.totalHours,

          price:
            subscriptionPackages.price,

          validityDays:
            subscriptionPackages.validityDays,

          description:
            subscriptionPackages.description,

          active:
            subscriptionPackages.active,

          createdAt:
            subscriptionPackages.createdAt,

          updatedAt:
            subscriptionPackages.updatedAt,
        })
        .from(
          subscriptionPackages,
        )
        .where(
          eq(
            subscriptionPackages.id,
            id,
          ),
        )
        .limit(1);

    const pkg =
      rows[0];

    if (!pkg) {
      return NextResponse.json(
        {
          error:
            "Subscription package not found.",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json({
      package: {
        id: pkg.id,

        name:
          pkg.name,

        totalHours:
          Number(
            pkg.totalHours,
          ),

        price:
          Number(
            pkg.price,
          ),

        validityDays:
          pkg.validityDays,

        description:
          pkg.description,

        active:
          pkg.active,

        createdAt:
          pkg.createdAt.toISOString(),

        updatedAt:
          pkg.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error(
      "Get subscription package error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Could not load subscription package.",
      },
      {
        status: 500,
      },
    );
  }
}

// ============================================================================
// PATCH PACKAGE
// ============================================================================
//
// Editing the package definition does NOT change historical customer
// subscriptions because they use snapshots.
// ============================================================================

export async function PATCH(
  req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    if (
      !canManage(
        user.role,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Only managers and admins can manage subscription packages.",
        },
        {
          status: 403,
        },
      );
    }

    const { id: rawId } =
      await params;

    const id =
      parseId(rawId);

    if (!id) {
      return NextResponse.json(
        {
          error:
            "Invalid package ID.",
        },
        {
          status: 400,
        },
      );
    }

    const body =
      (await req
        .json()
        .catch(
          () => null,
        )) as PackageBody | null;

    if (!body) {
      return NextResponse.json(
        {
          error:
            "Invalid request.",
        },
        {
          status: 400,
        },
      );
    }

    // ------------------------------------------------------------------------
    // FIND CURRENT PACKAGE
    // ------------------------------------------------------------------------

    const existingRows =
      await db
        .select({
          id:
            subscriptionPackages.id,

          name:
            subscriptionPackages.name,

          totalHours:
            subscriptionPackages.totalHours,

          price:
            subscriptionPackages.price,

          validityDays:
            subscriptionPackages.validityDays,

          description:
            subscriptionPackages.description,

          active:
            subscriptionPackages.active,
        })
        .from(
          subscriptionPackages,
        )
        .where(
          eq(
            subscriptionPackages.id,
            id,
          ),
        )
        .limit(1);

    const existing =
      existingRows[0];

    if (!existing) {
      return NextResponse.json(
        {
          error:
            "Subscription package not found.",
        },
        {
          status: 404,
        },
      );
    }

    // ------------------------------------------------------------------------
    // BUILD UPDATE SAFELY
    // ------------------------------------------------------------------------

    const updateValues:
      Partial<typeof subscriptionPackages.$inferInsert> =
      {};

    if (
      body.name !==
      undefined
    ) {
      const name =
        body.name.trim();

      if (!name) {
        return NextResponse.json(
          {
            error:
              "Package name cannot be empty.",
          },
          {
            status: 400,
          },
        );
      }

      if (
        name.length >
        200
      ) {
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

      updateValues.name =
        name;
    }

    if (
      body.totalHours !==
      undefined
    ) {
      const totalHours =
        parsePositiveNumber(
          body.totalHours,
        );

      if (
        totalHours ===
        null
      ) {
        return NextResponse.json(
          {
            error:
              "Total hours must be greater than zero.",
          },
          {
            status: 400,
          },
        );
      }

      updateValues.totalHours =
        totalHours.toFixed(
          2,
        );
    }

    if (
      body.price !==
      undefined
    ) {
      const price =
        parseNonNegativeNumber(
          body.price,
        );

      if (
        price ===
        null
      ) {
        return NextResponse.json(
          {
            error:
              "Package price must be zero or greater.",
          },
          {
            status: 400,
          },
        );
      }

      updateValues.price =
        price.toFixed(
          2,
        );
    }

    if (
      body.validityDays !==
      undefined
    ) {
      const validityDays =
        parseValidityDays(
          body.validityDays,
        );

      if (
        validityDays ===
        "invalid"
      ) {
        return NextResponse.json(
          {
            error:
              "Validity days must be a positive whole number or empty for no expiry.",
          },
          {
            status: 400,
          },
        );
      }

      updateValues.validityDays =
        validityDays;
    }

    if (
      body.description !==
      undefined
    ) {
      updateValues.description =
        body.description
          ?.trim() ||
        null;
    }

    if (
      body.active !==
      undefined
    ) {
      updateValues.active =
        Boolean(
          body.active,
        );
    }

    // Nothing to change.
    if (
      Object.keys(
        updateValues,
      ).length === 0
    ) {
      return NextResponse.json({
        ok: true,

        message:
          "Nothing to update.",

        package: {
          id:
            existing.id,

          name:
            existing.name,

          totalHours:
            Number(
              existing.totalHours,
            ),

          price:
            Number(
              existing.price,
            ),

          validityDays:
            existing.validityDays,

          description:
            existing.description,

          active:
            existing.active,
        },
      });
    }

    // Always refresh updatedAt explicitly.
    updateValues.updatedAt =
      new Date();

    // ------------------------------------------------------------------------
    // UPDATE
    // ------------------------------------------------------------------------

    const updatedRows =
      await db
        .update(
          subscriptionPackages,
        )
        .set(
          updateValues,
        )
        .where(
          eq(
            subscriptionPackages.id,
            id,
          ),
        )
        .returning({
          id:
            subscriptionPackages.id,

          name:
            subscriptionPackages.name,

          totalHours:
            subscriptionPackages.totalHours,

          price:
            subscriptionPackages.price,

          validityDays:
            subscriptionPackages.validityDays,

          description:
            subscriptionPackages.description,

          active:
            subscriptionPackages.active,

          createdAt:
            subscriptionPackages.createdAt,

          updatedAt:
            subscriptionPackages.updatedAt,
        });

    const updated =
      updatedRows[0];

    if (!updated) {
      throw new Error(
        "Package update failed.",
      );
    }

    // ------------------------------------------------------------------------
    // AUDIT
    // ------------------------------------------------------------------------

    await db
      .insert(auditLogs)
      .values({
        userId:
          user.id,

        action:
          "package_updated",

        entityType:
          "subscription_package",

        entityId:
          id,

        details: {
          before: {
            name:
              existing.name,

            totalHours:
              Number(
                existing.totalHours,
              ),

            price:
              Number(
                existing.price,
              ),

            validityDays:
              existing.validityDays,

            description:
              existing.description,

            active:
              existing.active,
          },

          after: {
            name:
              updated.name,

            totalHours:
              Number(
                updated.totalHours,
              ),

            price:
              Number(
                updated.price,
              ),

            validityDays:
              updated.validityDays,

            description:
              updated.description,

            active:
              updated.active,
          },
        },
      });

    return NextResponse.json({
      ok: true,

      package: {
        id:
          updated.id,

        name:
          updated.name,

        totalHours:
          Number(
            updated.totalHours,
          ),

        price:
          Number(
            updated.price,
          ),

        validityDays:
          updated.validityDays,

        description:
          updated.description,

        active:
          updated.active,

        createdAt:
          updated.createdAt.toISOString(),

        updatedAt:
          updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error(
      "Update subscription package error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not update subscription package.",
      },
      {
        status: 500,
      },
    );
  }
}

// ============================================================================
// DELETE / DEACTIVATE
// ============================================================================
//
// We do NOT hard-delete a package that has ever been purchased.
// This protects historical references and accounting history.
//
// If it has never been purchased, it can be deleted.
// If it has been purchased, we deactivate it instead.
// ============================================================================

export async function DELETE(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    if (
      !canManage(
        user.role,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Only managers and admins can manage subscription packages.",
        },
        {
          status: 403,
        },
      );
    }

    const { id: rawId } =
      await params;

    const id =
      parseId(rawId);

    if (!id) {
      return NextResponse.json(
        {
          error:
            "Invalid package ID.",
        },
        {
          status: 400,
        },
      );
    }

    // ------------------------------------------------------------------------
    // CHECK PACKAGE
    // ------------------------------------------------------------------------

    const packageRows =
      await db
        .select({
          id:
            subscriptionPackages.id,

          name:
            subscriptionPackages.name,

          active:
            subscriptionPackages.active,
        })
        .from(
          subscriptionPackages,
        )
        .where(
          eq(
            subscriptionPackages.id,
            id,
          ),
        )
        .limit(1);

    const pkg =
      packageRows[0];

    if (!pkg) {
      return NextResponse.json(
        {
          error:
            "Subscription package not found.",
        },
        {
          status: 404,
        },
      );
    }

    // ------------------------------------------------------------------------
    // HAS HISTORICAL PURCHASES?
    // ------------------------------------------------------------------------

    const purchasedRows =
      await db
        .select({
          id:
            customerSubscriptions.id,
        })
        .from(
          customerSubscriptions,
        )
        .where(
          eq(
            customerSubscriptions.packageId,
            id,
          ),
        )
        .limit(1);

    const hasPurchases =
      purchasedRows.length >
      0;

    // ------------------------------------------------------------------------
    // NEVER PURCHASED -> HARD DELETE
    // ------------------------------------------------------------------------

    if (!hasPurchases) {
      await db
        .delete(
          subscriptionPackages,
        )
        .where(
          eq(
            subscriptionPackages.id,
            id,
          ),
        );

      await db
        .insert(auditLogs)
        .values({
          userId:
            user.id,

          action:
            "package_deleted",

          entityType:
            "subscription_package",

          entityId:
            id,

          details: {
            name:
              pkg.name,
          },
        });

      return NextResponse.json({
        ok: true,
        deleted: true,
        deactivated: false,
      });
    }

    // ------------------------------------------------------------------------
    // PURCHASED BEFORE -> DEACTIVATE ONLY
    // ------------------------------------------------------------------------

    await db
      .update(
        subscriptionPackages,
      )
      .set({
        active:
          false,

        updatedAt:
          new Date(),
      })
      .where(
        and(
          eq(
            subscriptionPackages.id,
            id,
          ),
          eq(
            subscriptionPackages.active,
            true,
          ),
        ),
      );

    await db
      .insert(auditLogs)
      .values({
        userId:
          user.id,

        action:
          "package_deactivated",

        entityType:
          "subscription_package",

        entityId:
          id,

        details: {
          name:
            pkg.name,

          reason:
            "Package has historical customer purchases and cannot be deleted.",
        },
      });

    return NextResponse.json({
      ok: true,

      deleted: false,

      deactivated: true,

      message:
        "Package was deactivated because it has historical customer purchases.",
    });
  } catch (error) {
    console.error(
      "Delete subscription package error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not delete or deactivate subscription package.",
      },
      {
        status: 500,
      },
    );
  }
}