/** Flat room price: `base` per hour covers `included` people, each extra person adds `extraPerPerson` per hour. */
export function formulaHourlyRate(input: { people: number; base: number; included: number; extraPerPerson: number }): number {
  const included = Math.max(1, Math.floor(input.included) || 1);
  const extraPeople = Math.max(0, Math.floor(input.people) - included);
  return Math.round((input.base + extraPeople * input.extraPerPerson) * 100) / 100;
}
