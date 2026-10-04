/**
 * Shared recurrence rules for meeting-room reservations.
 *
 *  - none:   a single reservation
 *  - daily:  the same time slot every day, `count` days in a row
 *  - weekly: the same time slot every 7 days, `count` times
 */
export type Recurrence = "none" | "daily" | "weekly";

export const RECURRENCE_VALUES: readonly Recurrence[] = [
  "none",
  "daily",
  "weekly",
];

export function parseRecurrence(value: unknown): Recurrence | null {
  if (value === undefined || value === null || value === "") return "none";
  return RECURRENCE_VALUES.includes(value as Recurrence)
    ? (value as Recurrence)
    : null;
}

export function recurrenceStepDays(recurrence: Recurrence): number {
  return recurrence === "weekly" ? 7 : 1;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function buildOccurrenceDates(
  start: Date,
  end: Date,
  recurrence: Recurrence,
  count: number,
): Array<{ start: Date; end: Date }> {
  if (recurrence === "none") {
    return [{ start: new Date(start), end: new Date(end) }];
  }
  const step = recurrenceStepDays(recurrence);
  return Array.from({ length: count }, (_, index) => ({
    start: addDays(start, index * step),
    end: addDays(end, index * step),
  }));
}
