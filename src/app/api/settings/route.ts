import { NextResponse } from "next/server";
import { getCurrentUser, canManage } from "@/lib/auth";
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
