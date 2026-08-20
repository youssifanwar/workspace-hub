import { NextResponse } from "next/server";
import { db } from "@/db";
import { desks } from "@/db/schema";
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

  const deskId = Number(id);
  const body = (await req.json()) as {
    hourlyRate?: number;
    name?: string;
    active?: boolean;
  };

  const update: {
    hourlyRate?: string;
    name?: string;
    active?: boolean;
  } = {};
  if (typeof body.hourlyRate === "number") {
    update.hourlyRate = body.hourlyRate.toFixed(2);
  }
  if (typeof body.name === "string" && body.name.trim())
    update.name = body.name.trim();
  if (typeof body.active === "boolean") update.active = body.active;

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "No changes" }, { status: 400 });

  await db.update(desks).set(update).where(eq(desks.id, deskId));
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

  await db.update(desks).set({ active: false }).where(eq(desks.id, Number(id)));
  return NextResponse.json({ ok: true });
}
