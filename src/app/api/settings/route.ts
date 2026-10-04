import { NextResponse } from "next/server";
import { getCurrentUser, canManage } from "@/lib/auth";
import { setSetting, SettingKey } from "@/lib/settings";

const ALLOWED_KEYS: SettingKey[] = [
  "workspace_name",
  "workspace_address",
  "workspace_phone",
  "currency",
  "invoice_footer",
  "auto_print_orders",
  "kitchen_printer_name",
  "invoice_printer_name",
  "public_base_url",
  "customer_session_1h",
  "customer_session_2h",
  "customer_session_3h",
  "customer_session_4h",
  "customer_session_day_pass",
  "meeting_room_early_checkin_minutes",
  "stale_session_hours",
];

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as Record<string, string | number>;

  const saved: string[] = [];

  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_KEYS.includes(k as SettingKey)) continue;

    // Accept both string and number values from the client (price fields are
    // sent as numbers), and coerce to the string format the settings table
    // stores. Previously this handler silently dropped any numeric value
    // (typeof v === "string" check), which made price-only forms (like
    // customer session pricing) appear to save successfully while nothing
    // was actually persisted.
    if (typeof v !== "string" && typeof v !== "number") continue;

    const stringValue = typeof v === "number" ? String(v) : v;

    await setSetting(k as SettingKey, stringValue);
    saved.push(k);
  }

  if (saved.length === 0) {
    return NextResponse.json(
      { error: "No valid settings were provided to update." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, saved });
}
