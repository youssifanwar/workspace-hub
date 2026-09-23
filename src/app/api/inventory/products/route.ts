import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { canManage, getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function parseNonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!canManage(user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await db.execute(sql`
      SELECT
        p.id,
        p.category_id,
        c.name AS category_name,
        p.name,
        p.price,
        p.icon,
        p.image_url,
        p.active,
        p.stock_quantity
      FROM products p
      INNER JOIN categories c ON c.id = p.category_id
      ORDER BY c.sort_order ASC, c.id ASC, p.name ASC, p.id ASC
    `);

    const products = result.rows.map((row) => ({
      id: Number(row.id),
      categoryId: Number(row.category_id),
      categoryName: String(row.category_name ?? ""),
      name: String(row.name ?? ""),
      price: Number(row.price ?? 0).toFixed(2),
      icon: String(row.icon ?? "🍔"),
      imageUrl: row.image_url == null ? null : String(row.image_url),
      active: Boolean(row.active),
      stockQuantity: Number(row.stock_quantity ?? 0),
    }));

    return NextResponse.json({ ok: true, products });
  } catch (error) {
    console.error("Inventory products GET error:", error);
    return NextResponse.json(
      { error: "Could not load inventory." },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!canManage(user.role)) {
      return NextResponse.json(
        { error: "Only managers/admins can update stock." },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => null)) as {
      productId?: unknown;
      stockQuantity?: unknown;
    } | null;

    const productId = parseNonNegativeInteger(body?.productId);
    const stockQuantity = parseNonNegativeInteger(body?.stockQuantity);

    if (!productId || productId <= 0) {
      return NextResponse.json({ error: "Invalid product id." }, { status: 400 });
    }

    if (stockQuantity === null) {
      return NextResponse.json(
        { error: "Stock quantity must be a non-negative whole number." },
        { status: 400 },
      );
    }

    const result = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        SELECT id, name, active, stock_quantity
        FROM products
        WHERE id = ${productId}
        FOR UPDATE
      `);

      const product = rows.rows?.[0] as
        | { id?: unknown; name?: unknown; active?: unknown; stock_quantity?: unknown }
        | undefined;

      if (!product) {
        throw new Error("PRODUCT_NOT_FOUND");
      }

      const previousStock = Number(product.stock_quantity ?? 0);

      const updatedRows = await tx.execute(sql`
        UPDATE products
        SET stock_quantity = ${stockQuantity}
        WHERE id = ${productId}
        RETURNING id, name, stock_quantity, active
      `);

      const updated = updatedRows.rows?.[0] as
        | { id?: unknown; name?: unknown; stock_quantity?: unknown; active?: unknown }
        | undefined;

      if (!updated) {
        throw new Error("PRODUCT_UPDATE_FAILED");
      }

      await tx.insert(auditLogs).values({
        userId: user.id,
        action: "product_stock_updated",
        entityType: "product",
        entityId: productId,
        details: {
          productId,
          productName: String(updated.name ?? product.name ?? ""),
          previousStock,
          newStock: stockQuantity,
        },
      });

      return {
        id: Number(updated.id),
        name: String(updated.name ?? ""),
        stockQuantity: Number(updated.stock_quantity ?? 0),
        active: Boolean(updated.active),
      };
    });

    return NextResponse.json({ ok: true, product: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message === "PRODUCT_NOT_FOUND") {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }

    if (message === "PRODUCT_UPDATE_FAILED") {
      return NextResponse.json({ error: "Could not update product stock." }, { status: 500 });
    }

    console.error("Inventory products PATCH error:", error);
    return NextResponse.json(
      { error: "Could not update product stock." },
      { status: 500 },
    );
  }
}
