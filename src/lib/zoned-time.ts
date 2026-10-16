/**
 * Wall-clock <-> instant conversion for an explicit IANA timezone.
 *
 * Booking forms ask for "14:00 on 5 March". That must mean 14:00 in the
 * WORKSPACE's timezone no matter what timezone the browser or server is
 * in — otherwise a reservation can land hours off. Pure functions, safe to
 * import from client and server code.
 */

function partsInZone(instant: number, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(instant))) {
    p[part.type] = part.value;
  }
  return p;
}

function offsetMs(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  const p = partsInZone(whole, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - whole;
}

/** "2026-03-05" + "14:00" in `timeZone` -> the matching instant, or null. */
export function zonedWallTimeToDate(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const t = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!d || !t) return null;
  const guess = Date.UTC(
    Number(d[1]),
    Number(d[2]) - 1,
    Number(d[3]),
    Number(t[1]),
    Number(t[2]),
  );
  // Two passes handle timezones whose offset changes (DST) near `guess`.
  let result = guess - offsetMs(guess, timeZone);
  result = guess - offsetMs(result, timeZone);
  const date = new Date(result);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toZonedDateInput(date: Date, timeZone: string): string {
  const p = partsInZone(date.getTime(), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function toZonedTimeInput(date: Date, timeZone: string): string {
  const p = partsInZone(date.getTime(), timeZone);
  return `${p.hour}:${p.minute}`;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
