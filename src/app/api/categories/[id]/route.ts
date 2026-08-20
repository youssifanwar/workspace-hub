import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories, products } from "@/db/schema";
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

  const body = (await req.json()) as { name?: string; icon?: string };
  const update: { name?: string; icon?: string } = {};
  if (typeof body.name === "string" && body.name.trim())
    update.name = body.name.trim();
  if (typeof body.icon === "string") update.icon = body.icon;

  await db.update(categories).set(update).where(eq(categories.id, Number(id)));
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

  const catId = Number(id);
  await db.update(products).set({ active: false }).where(eq(products.categoryId, catId));
  await db.delete(categories).where(eq(categories.id, catId));
  return NextResponse.json({ ok: true });
}
