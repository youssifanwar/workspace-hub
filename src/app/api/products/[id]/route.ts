import { NextResponse } from "next/server";

import { db } from "@/db";

import { products } from "@/db/schema";

import { eq } from "drizzle-orm";

import {
  getCurrentUser,
  canManage,
} from "@/lib/auth";

function parseProductId(
  value: string,
): number | null {
  const id = Number(value);

  if (
    !Number.isSafeInteger(id) ||
    id <= 0
  ) {
    return null;
  }

  return id;
}

function isPositiveInteger(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function isValidPrice(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  );
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
    /* PARAMS                                                                 */
    /* ---------------------------------------------------------------------- */

    const {
      id: rawId,
    } = await params;

    const id =
      parseProductId(
        rawId,
      );

    if (id === null) {
      return NextResponse.json(
        {
          error:
            "Invalid product id",
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
    /* BUILD UPDATE                                                           */
    /* ---------------------------------------------------------------------- */

    const update: {
      categoryId?: number;

      name?: string;

      price?: string;

      icon?: string;

      imageUrl?: string | null;
    } = {};

    /* ---------------------------------------------------------------------- */
    /* CATEGORY                                                               */
    /* ---------------------------------------------------------------------- */

    if (
      body.categoryId !==
        undefined
    ) {
      if (
        !isPositiveInteger(
          body.categoryId,
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Invalid categoryId",
          },
          {
            status: 400,
          },
        );
      }

      update.categoryId =
        body.categoryId;
    }

    /* ---------------------------------------------------------------------- */
    /* NAME                                                                   */
    /* ---------------------------------------------------------------------- */

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
              "Invalid product name",
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
              "Product name cannot be empty",
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

      update.name =
        name;
    }

    /* ---------------------------------------------------------------------- */
    /* PRICE                                                                  */
    /* ---------------------------------------------------------------------- */

    if (
      body.price !==
      undefined
    ) {
      if (
        !isValidPrice(
          body.price,
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

      update.price =
        body.price.toFixed(
          2,
        );
    }

    /* ---------------------------------------------------------------------- */
    /* ICON                                                                   */
    /* ---------------------------------------------------------------------- */

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
              "Invalid product icon",
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
              "Product icon is too long",
          },
          {
            status: 400,
          },
        );
      }

      update.icon =
        icon ||
        "🍔";
    }

    /* ---------------------------------------------------------------------- */
    /* IMAGE URL                                                              */
    /* ---------------------------------------------------------------------- */

    if (
      body.imageUrl !==
      undefined
    ) {
      if (
        body.imageUrl !==
          null &&
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

      if (
        body.imageUrl ===
        null
      ) {
        update.imageUrl =
          null;
      } else {
        const imageUrl =
          body.imageUrl.trim();

        if (
          imageUrl.length >
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

        update.imageUrl =
          imageUrl ||
          null;
      }
    }

    /* ---------------------------------------------------------------------- */
    /* EMPTY UPDATE                                                           */
    /* ---------------------------------------------------------------------- */

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
          products,
        )
        .set(update)
        .where(
          eq(
            products.id,
            id,
          ),
        )
        .returning();

    if (!row) {
      return NextResponse.json(
        {
          error:
            "Product not found",
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
        product:
          row,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error(
      "[products PATCH] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to update product",
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
    /* PARAMS                                                                 */
    /* ---------------------------------------------------------------------- */

    const {
      id: rawId,
    } = await params;

    const id =
      parseProductId(
        rawId,
      );

    if (id === null) {
      return NextResponse.json(
        {
          error:
            "Invalid product id",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* SOFT DELETE                                                            */
    /* ---------------------------------------------------------------------- */

    const [
      row,
    ] =
      await db
        .update(
          products,
        )
        .set({
          active: false,
        })
        .where(
          eq(
            products.id,
            id,
          ),
        )
        .returning();

    if (!row) {
      return NextResponse.json(
        {
          error:
            "Product not found",
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
        product:
          row,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error(
      "[products DELETE] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to deactivate product",
      },
      {
        status: 500,
      },
    );
  }
}