import type { ZoneType } from '../../../src/types.js';

/**
 * NATS UAS dataset conventions (verified 2026-09-25):
 *   type R + localType FRZ  -> aerodrome flight restriction zone (the 2-2.5 NM circle)
 *   type R + localType RPZ  -> runway protection zone (part of an aerodrome FRZ) when the
 *                              name ends in "RWY nn"; otherwise a non-aerodrome restricted
 *                              zone such as a prison
 *   type R, no localType    -> restricted area (nuclear sites and similar)
 *   type P / D              -> prohibited / danger
 */
export function mapZoneType(rawType: string | undefined, localType: string | undefined, name: string): ZoneType {
  const t = (rawType ?? '').toUpperCase();
  const l = (localType ?? '').toUpperCase();
  if (t === 'P') return 'prohibited';
  if (t === 'D') return 'danger';
  if (l === 'FRZ') return 'frz';
  if (l === 'RPZ') return /\bRWY\b/i.test(name) ? 'frz' : 'restricted';
  if (t === 'R') return 'restricted';
  return 'other';
}

/** "LONDON GATWICK RWY 26L" -> "LONDON GATWICK"; only for aerodrome zones. */
export function aerodromeNameOf(zoneType: ZoneType, name: string): string | null {
  if (zoneType !== 'frz') return null;
  return name.replace(/\s+RWY\s+\S+\s*$/i, '').replace(/\s+(FRZ|RPZ)\s*$/i, '').trim() || null;
}
