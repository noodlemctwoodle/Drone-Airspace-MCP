/** AIRAC cycle 2501 began on 23 January 2025; cycles are 28 days. */
export const AIRAC_EPOCH = Date.UTC(2025, 0, 23);
export const AIRAC_DAYS = 28;
const DAY_MS = 86_400_000;

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toCompact(d: Date): string {
  return toDateString(d).replace(/-/g, '');
}

function cycleStart(index: number): Date {
  return new Date(AIRAC_EPOCH + index * AIRAC_DAYS * DAY_MS);
}

export function cycleIndexFor(date: Date): number {
  return Math.floor((date.getTime() - AIRAC_EPOCH) / (AIRAC_DAYS * DAY_MS));
}

/** Effective date of the cycle in force on `date` (YYYY-MM-DD). */
export function currentCycle(date: Date = new Date()): string {
  return toDateString(cycleStart(cycleIndexFor(date)));
}

export function nextCycle(date: Date = new Date()): string {
  return toDateString(cycleStart(cycleIndexFor(date) + 1));
}

export function cycleEnd(effective: string): string {
  const d = new Date(`${effective}T00:00:00Z`);
  return toDateString(new Date(d.getTime() + (AIRAC_DAYS - 1) * DAY_MS));
}
