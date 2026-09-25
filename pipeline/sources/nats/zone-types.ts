import type { ZoneType } from '../../../src/types.js';

/**
 * NATS UAS dataset conventions (verified 2026-09-25):
 *   type R + localType FRZ  -> aerodrome flight restriction zone (the 2-2.5 NM circle),
 *                              except prisons: since January 2024 the feed carries every
 *                              closed prison and YOI as an "HMP ..." FRZ (SI 2023/1101)
 *   type R + localType RPZ  -> runway protection zone (part of an aerodrome FRZ) when the
 *                              name ends in "RWY nn"; otherwise a non-aerodrome restricted
 *                              zone (the Isle of Man prison is one)
 *   type R, no localType    -> restricted area (nuclear sites and similar)
 *   type P / D              -> prohibited / danger
 * Prisons are detected by name and notes, never by raw type, so the mapping survives NATS
 * moving them between FRZ and RPZ.
 */
const PRISON_NAME = /^HMP\b|^HMYOI\b|\bYOI\b|\bPRISON\b|^HM PRISON\b/i;
const PRISON_NOTES = /SI 2023\/1101|HMPPS/i;

export function isPrisonZone(rawType: string | undefined, name: string, notes = ''): boolean {
  return (rawType ?? '').toUpperCase() === 'R' && (PRISON_NAME.test(name) || PRISON_NOTES.test(notes));
}

export function mapZoneType(rawType: string | undefined, localType: string | undefined, name: string, notes = ''): ZoneType {
  const t = (rawType ?? '').toUpperCase();
  const l = (localType ?? '').toUpperCase();
  if (t === 'P') return 'prohibited';
  if (t === 'D') return 'danger';
  if (isPrisonZone(rawType, name, notes)) return 'prison';
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
