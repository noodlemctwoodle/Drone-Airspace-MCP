import type { VerticalLimit } from '../types.js';

export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return 'unknown distance';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

export function formatKm(km: number): string {
  return formatDistance(km * 1000);
}

export function formatCoord(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return 'unknown';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return typeof date === 'string' ? date : 'unknown';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return 'unknown';
  return date.slice(0, 10);
}

const REF_LABEL: Record<string, string> = { sfc: 'SFC', agl: 'ft AGL', amsl: 'ft AMSL', fl: 'FL', unl: 'UNL' };

export function formatLimit(limit: VerticalLimit): string {
  if (limit.ref === 'unl') return 'unlimited';
  if (limit.ref === 'sfc' || (limit.ft === 0 && limit.ref !== 'fl')) return 'SFC';
  if (limit.ft === null) return limit.raw ?? 'unknown';
  if (limit.ref === 'fl') return `FL ${Math.round(limit.ft / 100)}`;
  const ref = limit.ref ? REF_LABEL[limit.ref] : 'ft';
  return `${limit.ft.toLocaleString('en-GB')} ${ref}`;
}

export function formatLimits(lower: VerticalLimit, upper: VerticalLimit): string {
  return `${formatLimit(lower)} to ${formatLimit(upper)}`;
}

export function formatAgeSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'unknown';
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

export function truncate(text: string, max = 240): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 3)}...`;
}
