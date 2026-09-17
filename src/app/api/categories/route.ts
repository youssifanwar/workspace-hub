import { NextResponse } from "next/server";

import { db } from "@/db";

import { categories } from "@/db/schema";

import {
  getCurrentUser,
  canManage,
} from "@/lib/auth";

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
          error: "Forbidden",
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
      name?: string;
      icon?: string;
    };

    try {
      body =
        (await req.json()) as {
          name?: string;
          icon?: string;
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

    if (
      typeof body.name !==
      "string"
    ) {
      return NextResponse.json(
        {
          error:
            "Category name is required",
        },
        {
          status: 400,
        },
      );
    }

    const name =
      body.name.trim();

    if (!name) {
      return NextResponse.json(
        {
          error:
            "Category name is required",
        },
        {
          status: 400,
        },
      );
    }

    if (
      name.length >
      100
    ) {
      return NextResponse.json(
        {
          error:
            "Category name is too long",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* ICON                                                                   */
    /* ---------------------------------------------------------------------- */

    let icon =
      "🍽️";

    if (
      body.icon !==
      undefined
    ) {
      if (
        typeof body.icon !==
        "string"
      ) {
        return NextResponse.json(
          {
            error:
              "Invalid category icon",
          },
          {
            status: 400,
          },
        );
      }

      const trimmedIcon =
        body.icon.trim();

      if (
        trimmedIcon.length >
        20
      ) {
        return NextResponse.json(
          {
            error:
              "Category icon is too long",
          },
          {
            status: 400,
          },
        );
      }

      if (
        trimmedIcon
      ) {
        icon =
          trimmedIcon;
      }
    }

    /* ---------------------------------------------------------------------- */
    /* CREATE                                                                 */
    /* ---------------------------------------------------------------------- */

    const [
      row,
    ] =
      await db
        .insert(
          categories,
        )
        .values({
          name,
          icon,
        })
        .returning();

    if (!row) {
      return NextResponse.json(
        {
          error:
            "Failed to create category",
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
        category:
          row,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error(
      "[categories POST] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to create category",
      },
      {
        status: 500,
      },
    );
  }
}