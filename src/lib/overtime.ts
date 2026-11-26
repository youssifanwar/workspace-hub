/**
 * Meeting-room overtime: time past the booked end, after a grace period,
 * billed per started 15 minutes at the booking's hourly rate / 4.
 * Pure function so it can be tested on its own.
 */
export function computeOvertimeAmount(input: {
  endAt: Date | string;
  now: Date;
  graceMinutes: number;
  hourlyRate: number;
}): number {
  const grace = Math.max(0, Number.isFinite(input.graceMinutes) ? input.graceMinutes : 0);
  const rate = Number(input.hourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const overMin = (input.now.getTime() - new Date(input.endAt).getTime()) / 60000 - grace;
  if (!(overMin > 0)) return 0;
  const blocks = Math.ceil(overMin / 15);
  return Math.round(blocks * (rate / 4) * 100) / 100;
}
