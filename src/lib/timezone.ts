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
