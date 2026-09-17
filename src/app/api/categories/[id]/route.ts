import { NextResponse } from "next/server";

import { db } from "@/db";

import {
  categories,
  products,
} from "@/db/schema";

import {
  eq,
} from "drizzle-orm";

import {
  getCurrentUser,
  canManage,
} from "@/lib/auth";

function parseCategoryId(
  value: string,
): number | null {
  const id =
    Number(value);

  if (
    !Number.isSafeInteger(
      id,
    ) ||
    id <= 0
  ) {
    return null;
  }

  return id;
}

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
    /* PARAMS                                                                 */
    /* ---------------------------------------------------------------------- */

    const {
      id: rawId,
    } = await params;

    const id =
      parseCategoryId(
        rawId,
      );

    if (id === null) {
      return NextResponse.json(
        {
          error:
            "Invalid category id",
        },
        {
          status: 400,
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
    /* BUILD UPDATE                                                           */
    /* ---------------------------------------------------------------------- */

    const update: {
      name?: string;
      icon?: string;
    } = {};

    if (
      body.name !==
      undefined
    ) {
      if (
        typeof body.name !==
        "string"
      ) {
        return NextResponse.json(
          {
            error:
              "Invalid category name",
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
              "Category name cannot be empty",
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

      update.name =
        name;
    }

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

      const icon =
        body.icon.trim();

      if (
        icon.length >
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

      update.icon =
        icon ||
        "🍽️";
    }

    if (
      Object.keys(
        update,
      ).length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "No fields to update",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* UPDATE                                                                 */
    /* ---------------------------------------------------------------------- */

    const [
      row,
    ] =
      await db
        .update(
          categories,
        )
        .set(update)
        .where(
          eq(
            categories.id,
            id,
          ),
        )
        .returning();

    if (!row) {
      return NextResponse.json(
        {
          error:
            "Category not found",
        },
        {
          status: 404,
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
        status: 200,
      },
    );
  } catch (error) {
    console.error(
      "[categories PATCH] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to update category",
      },
      {
        status: 500,
      },
    );
  }
}

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
    /* PARAMS                                                                 */
    /* ---------------------------------------------------------------------- */

    const {
      id: rawId,
    } = await params;

    const id =
      parseCategoryId(
        rawId,
      );

    if (id === null) {
      return NextResponse.json(
        {
          error:
            "Invalid category id",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* CHECK CATEGORY                                                         */
    /* ---------------------------------------------------------------------- */

    const [
      category,
    ] =
      await db
        .select({
          id:
            categories.id,
        })
        .from(
          categories,
        )
        .where(
          eq(
            categories.id,
            id,
          ),
        )
        .limit(1);

    if (!category) {
      return NextResponse.json(
        {
          error:
            "Category not found",
        },
        {
          status: 404,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* PROTECT PRODUCT HISTORY                                                */
    /* ---------------------------------------------------------------------- */

    const [
      product,
    ] =
      await db
        .select({
          id:
            products.id,
        })
        .from(
          products,
        )
        .where(
          eq(
            products.categoryId,
            id,
          ),
        )
        .limit(1);

    if (product) {
      return NextResponse.json(
        {
          error:
            "Cannot delete a category that still has products. Reassign or remove its products first.",
        },
        {
          status: 409,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* DELETE CATEGORY                                                        */
    /* ---------------------------------------------------------------------- */

    const [
      deleted,
    ] =
      await db
        .delete(
          categories,
        )
        .where(
          eq(
            categories.id,
            id,
          ),
        )
        .returning({
          id:
            categories.id,
        });

    if (!deleted) {
      return NextResponse.json(
        {
          error:
            "Category not found",
        },
        {
          status: 404,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* RESPONSE                                                               */
    /* ---------------------------------------------------------------------- */

    return NextResponse.json(
      {
        ok: true,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error(
      "[categories DELETE] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to delete category",
      },
      {
        status: 500,
      },
    );
  }
}