import { NextResponse } from "next/server";
import { db } from "@/db";
import { products } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, canManage } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    categoryId?: number;
    name?: string;
    price?: number;
    icon?: string;
    imageUrl?: string | null;
  };

  const update: {
    categoryId?: number;
    name?: string;
    price?: string;
    icon?: string;
    imageUrl?: string | null;
  } = {};
  if (typeof body.categoryId === "number") update.categoryId = body.categoryId;
  if (typeof body.name === "string" && body.name.trim())
    update.name = body.name.trim();
  if (typeof body.price === "number") update.price = body.price.toFixed(2);
  if (typeof body.icon === "string") update.icon = body.icon;
  if (body.imageUrl !== undefined) update.imageUrl = body.imageUrl;

  await db.update(products).set(update).where(eq(products.id, Number(id)));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await db
    .update(products)
    .set({ active: false })
    .where(eq(products.id, Number(id)));
  return NextResponse.json({ ok: true });
}
