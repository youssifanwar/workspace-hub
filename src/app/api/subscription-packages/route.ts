import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  auditLogs,
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

// ============================================================================
// GET
// ============================================================================

export async function GET() {
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

    const packages =
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
        .orderBy(
          desc(
            subscriptionPackages.createdAt,
          ),
        );

    return NextResponse.json({
      packages:
        packages.map(
          (pkg) => ({
            id: pkg.id,
            name: pkg.name,
            totalHours: Number(
              pkg.totalHours,
            ),
            price: Number(
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
          }),
        ),
    });
  } catch (error) {
    console.error(
      "Get subscription packages error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Could not load subscription packages.",
      },
      {
        status: 500,
      },
    );
  }
}

// ============================================================================
// POST
// ============================================================================

export async function POST(
  req: Request,
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
    // NAME
    // ------------------------------------------------------------------------

    const name =
      body.name?.trim() || "";

    if (!name) {
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

    // ------------------------------------------------------------------------
    // HOURS
    // ------------------------------------------------------------------------

    const totalHours =
      parsePositiveNumber(
        body.totalHours,
      );

    if (
      totalHours === null
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

    // ------------------------------------------------------------------------
    // PRICE
    // ------------------------------------------------------------------------

    const price =
      parseNonNegativeNumber(
        body.price,
      );

    if (price === null) {
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

    // ------------------------------------------------------------------------
    // VALIDITY
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // CREATE
    // ------------------------------------------------------------------------

    const inserted =
      await db
        .insert(
          subscriptionPackages,
        )
        .values({
          name,

          totalHours:
            totalHours.toFixed(2),

          price:
            price.toFixed(2),

          validityDays:
            validityDays,

          description:
            body.description
              ?.trim() ||
            null,

          active:
            body.active ??
            true,
        })
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

    const pkg =
      inserted[0];

    if (!pkg) {
      throw new Error(
        "Package was not created.",
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
          "package_created",

        entityType:
          "subscription_package",

        entityId:
          pkg.id,

        details: {
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

          active:
            pkg.active,
        },
      });

    return NextResponse.json(
      {
        ok: true,

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
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error(
      "Create subscription package error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not create subscription package.",
      },
      {
        status: 500,
      },
    );
  }
}