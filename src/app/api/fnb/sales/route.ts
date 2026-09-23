import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export const dynamic = "force-dynamic";

const PAYMENT_METHODS = ["cash", "visa", "instapay"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

type SaleItemInput = {
  productId?: unknown;
  quantity?: unknown;
  note?: unknown;
};

type CreateSaleBody = {
  items?: unknown;
  paymentMethod?: unknown;
  paidAmount?: unknown;
  note?: unknown;
};

type ProductRow = {
  id: number;
  category_id: number;
  category_name: string;
  category_icon: string;
  name: string;
  price: string | number;
  icon: string;
  image_url: string | null;
  stock_quantity: number;
};

type LockedProductRow = {
  id: number;
  name: string;
  price: string | number;
  active: boolean;
  stock_quantity: number;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseNonNegativeMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(String(value).trim());

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  const cents = Math.round(parsed * 100);

  if (!Number.isSafeInteger(cents) || cents < 0) {
    return null;
  }

  return cents / 100;
}

function normalizeNote(value: unknown, maxLength = 1000): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const note = value.trim();

  if (!note || note.length > maxLength) {
    return null;
  }

  return note;
}

function parsePaymentMethod(value: unknown): PaymentMethod | null {
  if (typeof value !== "string") {
    return null;
  }

  return PAYMENT_METHODS.includes(value as PaymentMethod)
    ? (value as PaymentMethod)
    : null;
}

function uniqueItems(items: SaleItemInput[]): Array<{
  productId: number;
  quantity: number;
  note: string | null;
}> {
  const byProduct = new Map<number, { productId: number; quantity: number; note: string | null }>();

  for (const raw of items) {
    const productId = parsePositiveInteger(raw.productId);
    const quantity = parsePositiveInteger(raw.quantity);

    if (!productId) {
      throw new Error("Invalid product id.");
    }

    if (!quantity || quantity > 50) {
      throw new Error(`Invalid quantity for product ${productId}.`);
    }

    const existing = byProduct.get(productId);
    const nextQuantity = (existing?.quantity ?? 0) + quantity;

    if (nextQuantity > 100) {
      throw new Error(`Quantity for product ${productId} is too large.`);
    }

    byProduct.set(productId, {
      productId,
      quantity: nextQuantity,
      note: normalizeNote(raw.note),
    });
  }

  return [...byProduct.values()];
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.execute(sql`
      SELECT
        p.id,
        p.category_id,
        c.name AS category_name,
        c.icon AS category_icon,
        p.name,
        p.price,
        p.icon,
        p.image_url,
        p.stock_quantity
      FROM products p
      INNER JOIN categories c ON c.id = p.category_id
      WHERE p.active = true
      ORDER BY c.sort_order ASC, c.id ASC, p.name ASC, p.id ASC
    `);

    const products = (result.rows as ProductRow[]).map((row) => ({
      id: Number(row.id),
      categoryId: Number(row.category_id),
      categoryName: row.category_name,
      categoryIcon: row.category_icon,
      name: row.name,
      price: Number(row.price).toFixed(2),
      icon: row.icon,
      imageUrl: row.image_url,
      stockQuantity: Number(row.stock_quantity),
    }));

    const categories = [...new Map(
      products.map((product) => [
        product.categoryId,
        {
          id: product.categoryId,
          name: product.categoryName,
          icon: product.categoryIcon,
        },
      ]),
    ).values()];

    return NextResponse.json({ ok: true, products, categories });
  } catch (error) {
    console.error("Direct F&B sale products error:", error);
    return NextResponse.json(
      { error: "Could not load the F&B products." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const activeShift = await getActiveShiftForUser(user.id);

    if (!activeShift) {
      return NextResponse.json(
        { error: "Open a shift before creating a direct F&B sale." },
        { status: 400 },
      );
    }

    const body = (await req.json().catch(() => null)) as CreateSaleBody | null;

    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: "At least one F&B item is required." },
        { status: 400 },
      );
    }

    if (body.items.length > 100) {
      return NextResponse.json(
        { error: "Too many F&B items in one sale." },
        { status: 400 },
      );
    }

    const paymentMethod = parsePaymentMethod(body.paymentMethod);

    if (!paymentMethod) {
      return NextResponse.json(
        { error: "Payment method must be cash, visa or instapay." },
        { status: 400 },
      );
    }

    const paidAmount = parseNonNegativeMoney(body.paidAmount);

    if (paidAmount === null) {
      return NextResponse.json(
        { error: "A valid paid amount is required." },
        { status: 400 },
      );
    }

    let items: ReturnType<typeof uniqueItems>;

    try {
      items = uniqueItems(body.items as SaleItemInput[]);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid sale items." },
        { status: 400 },
      );
    }

    if (items.length === 0) {
      return NextResponse.json(
        { error: "At least one valid F&B item is required." },
        { status: 400 },
      );
    }

    const result = await db.transaction(async (tx) => {
      // Serialize direct-sale stock updates so two cashiers cannot oversell
      // the same product at the same time.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(29009, ${activeShift.id})`);

      const lockedProducts = new Map<number, LockedProductRow>();

      for (const item of items) {
        const rows = await tx.execute(sql`
          SELECT
            id,
            name,
            price,
            active,
            stock_quantity
          FROM products
          WHERE id = ${item.productId}
          FOR UPDATE
        `);

        const product = (rows.rows?.[0] as LockedProductRow | undefined) ?? undefined;

        if (!product || !product.active) {
          throw new Error(`Product ${item.productId} is unavailable.`);
        }

        lockedProducts.set(item.productId, {
          id: Number(product.id),
          name: product.name,
          price: product.price,
          active: Boolean(product.active),
          stock_quantity: Number(product.stock_quantity),
        });
      }

      const lineItems = items.map((item) => {
        const product = lockedProducts.get(item.productId);

        if (!product) {
          throw new Error(`Product ${item.productId} is unavailable.`);
        }

        if (product.stock_quantity < item.quantity) {
          throw new Error(
            `Insufficient stock for ${product.name}. Available: ${product.stock_quantity}.`,
          );
        }

        const unitPrice = roundMoney(Number(product.price));

        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new Error(`Invalid price for ${product.name}.`);
        }

        return {
          ...item,
          nameSnapshot: product.name,
          unitPrice,
          lineTotal: roundMoney(unitPrice * item.quantity),
        };
      });

      const subtotal = roundMoney(
        lineItems.reduce((sum, item) => sum + item.lineTotal, 0),
      );
      const discount = 0;
      const total = roundMoney(subtotal - discount);

      if (paidAmount < total) {
        throw new Error(
          `Paid amount must be at least ${total.toFixed(2)} EGP.`,
        );
      }

      const changeAmount = roundMoney(paidAmount - total);
      const note = normalizeNote(body.note, 2000);

      const saleRows = await tx.execute(sql`
        INSERT INTO fnb_sales (
          shift_id,
          user_id,
          subtotal,
          discount,
          total,
          paid_amount,
          change_amount,
          payment_method,
          note
        )
        VALUES (
          ${activeShift.id},
          ${user.id},
          ${subtotal.toFixed(2)},
          ${discount.toFixed(2)},
          ${total.toFixed(2)},
          ${paidAmount.toFixed(2)},
          ${changeAmount.toFixed(2)},
          ${paymentMethod},
          ${note}
        )
        RETURNING id, created_at
      `);

      const sale = saleRows.rows?.[0] as
        | { id?: unknown; created_at?: unknown }
        | undefined;

      const saleId = Number(sale?.id);

      if (!Number.isSafeInteger(saleId) || saleId <= 0) {
        throw new Error("Could not create the F&B sale.");
      }

      for (const item of lineItems) {
        await tx.execute(sql`
          UPDATE products
          SET stock_quantity = stock_quantity - ${item.quantity}
          WHERE id = ${item.productId}
            AND active = true
            AND stock_quantity >= ${item.quantity}
        `);

        const checkRows = await tx.execute(sql`
          SELECT stock_quantity
          FROM products
          WHERE id = ${item.productId}
          LIMIT 1
        `);

        const remainingStock = Number(
          (checkRows.rows?.[0] as { stock_quantity?: unknown } | undefined)
            ?.stock_quantity,
        );

        if (!Number.isFinite(remainingStock) || remainingStock < 0) {
          throw new Error(`Could not update stock for ${item.nameSnapshot}.`);
        }

        await tx.execute(sql`
          INSERT INTO fnb_sale_items (
            sale_id,
            product_id,
            name_snapshot,
            unit_price,
            quantity,
            item_note
          )
          VALUES (
            ${saleId},
            ${item.productId},
            ${item.nameSnapshot},
            ${item.unitPrice.toFixed(2)},
            ${item.quantity},
            ${item.note}
          )
        `);
      }

      await tx.insert(auditLogs).values({
        userId: user.id,
        action: "fnb_direct_sale_created",
        entityType: "fnb_sale",
        entityId: saleId,
        details: {
          saleId,
          shiftId: activeShift.id,
          paymentMethod,
          subtotal,
          discount,
          total,
          paidAmount,
          changeAmount,
          itemCount: lineItems.reduce((sum, item) => sum + item.quantity, 0),
          items: lineItems.map((item) => ({
            productId: item.productId,
            name: item.nameSnapshot,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      });

      return {
        saleId,
        saleNumber: `FNB-${String(saleId).padStart(6, "0")}`,
        createdAt:
          sale?.created_at instanceof Date
            ? sale.created_at.toISOString()
            : new Date().toISOString(),
        subtotal,
        discount,
        total,
        paidAmount,
        changeAmount,
        paymentMethod,
        items: lineItems.map((item) => ({
          productId: item.productId,
          name: item.nameSnapshot,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        })),
      };
    });

    return NextResponse.json({ ok: true, sale: result }, { status: 201 });
  } catch (error) {
    console.error("Direct F&B sale error:", error);

    const message = error instanceof Error ? error.message : "Could not create F&B sale.";

    if (
      message.startsWith("Insufficient stock") ||
      message.startsWith("Product ") ||
      message.startsWith("Paid amount") ||
      message.startsWith("Invalid price") ||
      message.startsWith("Could not update stock")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Could not complete the F&B sale." },
      { status: 500 },
    );
  }
}
