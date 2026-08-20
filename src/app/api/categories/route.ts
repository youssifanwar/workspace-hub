import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { getCurrentUser, canManage } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as { name?: string; icon?: string };
  if (!body.name?.trim())
    return NextResponse.json({ error: "name required" }, { status: 400 });

  const [row] = await db
    .insert(categories)
    .values({ name: body.name.trim(), icon: body.icon || "🍽️" })
    .returning();
  return NextResponse.json({ ok: true, category: row });
}
