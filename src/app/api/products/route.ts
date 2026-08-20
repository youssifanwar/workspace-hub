import { NextResponse } from "next/server";
import { db } from "@/db";
import { products } from "@/db/schema";
import { getCurrentUser, canManage } from "@/lib/auth";

export async function POST(req: Request) {
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
  if (!body.name?.trim() || !body.categoryId)
    return NextResponse.json({ error: "name and categoryId required" }, { status: 400 });

  const [row] = await db
    .insert(products)
    .values({
      categoryId: body.categoryId,
      name: body.name.trim(),
      price: (body.price ?? 0).toFixed(2),
      icon: body.icon || "🍔",
      imageUrl: body.imageUrl || null,
    })
    .returning();
  return NextResponse.json({ ok: true, product: row });
}
