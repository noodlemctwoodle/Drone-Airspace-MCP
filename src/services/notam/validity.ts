/** `2609251200` -> 2026-09-25T12:00Z. `PERM` -> 'PERM'. Anything else -> undefined. */
export function parseNotamTime(text: string | null | undefined): Date | 'PERM' | undefined {
  if (!text) return undefined;
  const t = text.trim().toUpperCase();
  if (t === 'PERM') return 'PERM';
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*EST)?$/.exec(t);
  if (!m) return undefined;
  const [yy, mo, dd, hh, mi] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(2000 + yy, mo - 1, dd, hh, mi));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function isInForce(validFrom: Date | null, validTo: Date | 'PERM' | null, at: Date): boolean {
  if (validFrom && at < validFrom) return false;
  if (validTo === 'PERM' || validTo === null) return true;
  return at <= validTo;
}

/** ISO date or date-time; date-only is treated as midday UTC that day. */
export function parseUserDate(text: string | undefined, now: () => Date = () => new Date()): Date {
  if (!text || text.trim() === '') return now();
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(`${t}T12:00:00Z`);
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(t);
  const d = new Date(hasOffset ? t : `${t}Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Unrecognised date "${text}"; use ISO 8601 such as 2026-10-01 or 2026-10-01T14:00Z.`);
  return d;
}
