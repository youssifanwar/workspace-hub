import { DEFAULTS, getSetting } from "@/lib/settings";

/**
 * The workspace timezone is a Setting (not code). Servers (e.g. Vercel) run
 * in UTC, so every server-rendered page must format dates in the
 * workspace's own timezone or times appear hours off.
 *
 * It is one workspace-wide value, identical for every request, so holding
 * the last-loaded value in module scope is safe: pages call
 * `await loadTimezone()` once at the start of a render and the format
 * helpers read `activeTimeZone()`.
 */
let activeTz: string = DEFAULTS.timezone;

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function loadTimezone(): Promise<string> {
  const raw = (await getSetting("timezone"))?.trim();
  activeTz = raw && isValidTimeZone(raw) ? raw : DEFAULTS.timezone;
  return activeTz;
}

export function activeTimeZone(): string {
  return activeTz;
}

/**
 * Return the UTC instants corresponding to the start of the requested
 * calendar-day window in the workspace timezone. This avoids assuming the
 * hosting machine is in the workspace timezone (Railway/Vercel commonly run
 * in UTC while the workspace is in Africa/Cairo).
 */
function datePartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function zonedMidnightToUtc(year: number, month: number, day: number, timeZone: string): Date {
  const targetWallClock = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let guess = targetWallClock;

  // Iteratively correct the difference between the target wall time and the
  // same instant rendered in the desired timezone. This also handles DST.
  for (let i = 0; i < 5; i += 1) {
    const local = datePartsInTimeZone(new Date(guess), timeZone);
    const renderedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
      0,
    );
    const correction = targetWallClock - renderedAsUtc;
    if (correction === 0) break;
    guess += correction;
  }

  return new Date(guess);
}

/**
 * Inclusive UTC date bounds for N calendar days ending today in `timeZone`.
 * `days` is clamped to a sane positive integer; the result's `to` is the final
 * millisecond before the next local midnight.
 */
export function getZonedDayRange(
  days: number,
  timeZone: string = activeTimeZone(),
  now: Date = new Date(),
): { from: Date; to: Date; todayStart: Date } {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(3660, Math.floor(days))) : 1;
  const current = datePartsInTimeZone(now, timeZone);
  const todayCalendar = Date.UTC(current.year, current.month - 1, current.day);
  const firstCalendar = new Date(todayCalendar - (safeDays - 1) * 86_400_000);
  const nextCalendar = new Date(todayCalendar + 86_400_000);

  const from = zonedMidnightToUtc(
    firstCalendar.getUTCFullYear(),
    firstCalendar.getUTCMonth() + 1,
    firstCalendar.getUTCDate(),
    timeZone,
  );
  const todayStart = zonedMidnightToUtc(current.year, current.month, current.day, timeZone);
  const nextMidnight = zonedMidnightToUtc(
    nextCalendar.getUTCFullYear(),
    nextCalendar.getUTCMonth() + 1,
    nextCalendar.getUTCDate(),
    timeZone,
  );

  return { from, to: new Date(nextMidnight.getTime() - 1), todayStart };
}

