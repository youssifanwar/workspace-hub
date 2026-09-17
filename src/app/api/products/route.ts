import { NextResponse } from "next/server";

import { db } from "@/db";

import { products } from "@/db/schema";

import {
  getCurrentUser,
  canManage,
} from "@/lib/auth";

function isPositiveInteger(
  value: unknown,
): value is number {
  return (
    typeof value ===
      "number" &&
    Number.isInteger(
      value,
    ) &&
    value > 0
  );
}

function isValidPrice(
  value: unknown,
): value is number {
  return (
    typeof value ===
      "number" &&
    Number.isFinite(
      value,
    ) &&
    value > 0
  );
}

export async function POST(
  req: Request,
) {
  try {
    /* ---------------------------------------------------------------------- */
    /* AUTH                                                                   */
    /* ---------------------------------------------------------------------- */

    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Unauthorized",
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
            "Forbidden",
        },
        {
          status: 403,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* BODY                                                                   */
    /* ---------------------------------------------------------------------- */

    let body: {
      categoryId?: number;

      name?: string;

      price?: number;

      icon?: string;

      imageUrl?: string | null;
    };

    try {
      body =
        (await req.json()) as {
          categoryId?: number;

          name?: string;

          price?: number;

          icon?: string;

          imageUrl?: string | null;
        };
    } catch {
      return NextResponse.json(
        {
          error:
            "Invalid JSON body",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* NAME                                                                   */
    /* ---------------------------------------------------------------------- */

    const name =
      body.name?.trim() ??
      "";

    if (!name) {
      return NextResponse.json(
        {
          error:
            "Product name is required",
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
            "Product name is too long",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* CATEGORY                                                               */
    /* ---------------------------------------------------------------------- */

    const categoryId =
      body.categoryId;

    if (
      !isPositiveInteger(
        categoryId,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Valid categoryId is required",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* PRICE                                                                  */
    /* ---------------------------------------------------------------------- */

    const price =
      body.price;

    if (
      !isValidPrice(
        price,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Product price must be greater than zero",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* ICON                                                                   */
    /* ---------------------------------------------------------------------- */

    const icon =
      typeof body.icon ===
      "string"
        ? body.icon.trim()
        : "";

    const normalizedIcon =
      icon || "🍔";

    if (
      normalizedIcon.length >
      20
    ) {
      return NextResponse.json(
        {
          error:
            "Product icon is too long",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* IMAGE URL                                                              */
    /* ---------------------------------------------------------------------- */

    let imageUrl:
      | string
      | null = null;

    if (
      body.imageUrl !==
        null &&
      body.imageUrl !==
        undefined
    ) {
      if (
        typeof body.imageUrl !==
        "string"
      ) {
        return NextResponse.json(
          {
            error:
              "Invalid imageUrl",
          },
          {
            status: 400,
          },
        );
      }

      const trimmedImageUrl =
        body.imageUrl.trim();

      if (
        trimmedImageUrl.length >
        2000
      ) {
        return NextResponse.json(
          {
            error:
              "imageUrl is too long",
          },
          {
            status: 400,
          },
        );
      }

      imageUrl =
        trimmedImageUrl ||
        null;
    }

    /* ---------------------------------------------------------------------- */
    /* CREATE PRODUCT                                                         */
    /* ---------------------------------------------------------------------- */

    const [
      row,
    ] =
      await db
        .insert(
          products,
        )
        .values({
          categoryId,

          name,

          price:
            price.toFixed(
              2,
            ),

          icon:
            normalizedIcon,

          imageUrl,
        })
        .returning();

    if (!row) {
      return NextResponse.json(
        {
          error:
            "Failed to create product",
        },
        {
          status: 500,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* RESPONSE                                                               */
    /* ---------------------------------------------------------------------- */

    return NextResponse.json(
      {
        ok: true,

        product:
          row,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error(
      "[products POST] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to create product",
      },
      {
        status: 500,
      },
    );
  }
}