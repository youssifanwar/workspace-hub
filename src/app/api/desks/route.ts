import { NextResponse } from "next/server";
import { db } from "@/db";
import { desks } from "@/db/schema";
import { getCurrentUser, canManage } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    name?: string;
    type?: "desk" | "meeting_room";
    hourlyRate?: number;
    sortOrder?: number;
  };
  if (!body.name?.trim() || !body.type)
    return NextResponse.json({ error: "name and type required" }, { status: 400 });

  const [row] = await db
    .insert(desks)
    .values({
      name: body.name.trim(),
      type: body.type,
      hourlyRate: (body.hourlyRate ?? 0).toFixed(2),
      sortOrder: body.sortOrder ?? 0,
    })
    .returning();
  return NextResponse.json({ ok: true, desk: row });
}
