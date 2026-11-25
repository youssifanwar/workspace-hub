import { NextResponse } from "next/server";
import { getCurrentUser, canManage } from "@/lib/auth";
import { isValidTimeZone } from "@/lib/timezone";
import {
  serializeSessionTiers,
  setSetting,
  SettingKey,
  type SessionPricingTier,
} from "@/lib/settings";

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
  "customer_session_tiers",
  "customer_session_day_pass",
  "meeting_room_early_checkin_minutes",
  "stale_session_hours",
  "timezone",
  "calendar_week_starts_on",
  "calendar_start_hour",
  "calendar_end_hour",
  "meeting_room_max_booking_hours",
  "qr_max_pending_orders",
  "package_max_hours_per_session",
  "staff_max_discount_percent",
  "brand_color",
  "feature_memberships",
  "feature_companies",
  "meeting_room_overtime_billing",
  "meeting_room_overtime_grace_minutes",
];

/**
 * `customer_session_tiers` is accepted either as a JSON string (already
 * serialized) or as an array of { hours, price } objects straight from the
 * client — both are validated and re-serialized here so bad data can never
 * reach the database.
 */
function normalizeSessionTiersValue(raw: unknown): string | null {
  let candidate: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(candidate)) return null;

  const tiers: SessionPricingTier[] = [];
  for (const entry of candidate) {
    if (!entry || typeof entry !== "object") return null;
    const hours = Number((entry as { hours?: unknown }).hours);
    const price = Number((entry as { price?: unknown }).price);
    if (
      !Number.isInteger(hours) ||
      hours <= 0 ||
      hours > 24 * 31 ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      return null;
    }
    tiers.push({ hours, price });
  }
  if (tiers.length === 0) return null;

  // Reject duplicate hour values rather than silently overriding one.
  const seen = new Set<number>();
  for (const tier of tiers) {
    if (seen.has(tier.hours)) return null;
    seen.add(tier.hours);
  }

  return serializeSessionTiers(tiers);
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as Record<string, unknown>;

  const saved: string[] = [];

  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_KEYS.includes(k as SettingKey)) continue;

    if (k === "customer_session_tiers") {
      const normalized = normalizeSessionTiersValue(v);
      if (normalized === null) {
        return NextResponse.json(
          {
            error:
              "Invalid session pricing tiers. Each tier needs a whole number of hours (1–744) and a price ≥ 0, with no two tiers sharing the same hours.",
          },
          { status: 400 },
        );
      }
      await setSetting("customer_session_tiers", normalized);
      saved.push(k);
      continue;
    }

    const INT_RANGES: Partial<Record<string, [number, number, string]>> = {
      calendar_week_starts_on: [0, 6, "Week start must be 0 (Sunday) to 6 (Saturday)."],
      calendar_start_hour: [0, 23, "Calendar start hour must be 0–23."],
      calendar_end_hour: [1, 24, "Calendar end hour must be 1–24."],
      meeting_room_max_booking_hours: [1, 24, "Max booking hours must be 1–24."],
      stale_session_hours: [1, 72, "Stale session hours must be 1–72."],
      package_max_hours_per_session: [0, 24, "Package hours cap must be 0–24."],
      qr_max_pending_orders: [1, 50, "Pending QR orders limit must be 1–50."],
      staff_max_discount_percent: [0, 100, "Discount limit must be 0–100."],
      meeting_room_overtime_grace_minutes: [0, 240, "Overtime grace minutes must be 0–240."],
      meeting_room_early_checkin_minutes: [0, 1440, "Early check-in minutes must be 0–1440."],
    };
    if ((k === "feature_memberships" || k === "feature_companies" || k === "meeting_room_overtime_billing") && String(v) !== "0" && String(v) !== "1") {
      return NextResponse.json({ error: "Feature flag must be 0 or 1." }, { status: 400 });
    }
    if (k === "brand_color" && !(typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()))) {
      return NextResponse.json(
        { error: "Brand color must be a hex value like #4f46e5." },
        { status: 400 },
      );
    }
    if (k === "timezone") {
      if (typeof v !== "string" || !isValidTimeZone(v.trim())) {
        return NextResponse.json(
          { error: "Unknown timezone. Use a name like Africa/Cairo or Asia/Riyadh." },
          { status: 400 },
        );
      }
    }
    const range = INT_RANGES[k];
    if (range) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < range[0] || n > range[1]) {
        return NextResponse.json({ error: range[2] }, { status: 400 });
      }
    }
    if (
      k === "calendar_end_hour" &&
      "calendar_start_hour" in body &&
      Number(v) <= Number(body.calendar_start_hour)
    ) {
      return NextResponse.json(
        { error: "Calendar end hour must be after the start hour." },
        { status: 400 },
      );
    }

    // Accept both string and number values from the client (price fields
    // are sent as numbers), and coerce to the string format the settings
    // table stores. Previously this handler silently dropped any numeric
    // value (typeof v === "string" check), which made price-only forms
    // appear to save successfully while nothing was actually persisted.
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
