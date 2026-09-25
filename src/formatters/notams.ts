import type { Notam, NotamHit } from '../types.js';
import { formatCoord, formatDateTime, truncate } from './units.js';

function validity(n: Notam): string {
  const from = formatDateTime(n.validFrom);
  const to = n.validTo === 'PERM' ? 'PERM' : formatDateTime(n.validTo);
  return `${from} to ${to}${n.estimated ? ' (EST)' : ''}`;
}

function limits(n: Notam): string {
  if (n.itemF || n.itemG) return `${n.itemF ?? '?'} to ${n.itemG ?? '?'}`;
  if (n.lowerFl !== null && n.upperFl !== null) return `FL ${n.lowerFl} to FL ${n.upperFl}`;
  return 'limits not stated';
}

export function renderNotam(n: NotamHit): string {
  const where = n.centre ? `${formatCoord(n.centre[1], n.centre[0])} radius ${n.radiusNm} NM (${n.radiusKm} km), ${n.distanceKm} km from point` : 'no position';
  const head = `${n.id}${n.qCode ? ` ${n.qCode}` : ''}: ${where}; ${limits(n)}; valid ${validity(n)}${n.schedule ? `; schedule ${n.schedule}` : ''}`;
  return `${head}\n    ${truncate(n.itemE, 600)}`;
}

export function renderUnlocated(n: Notam): string {
  const why = n.wholeFir ? 'whole FIR' : 'no usable position';
  return `${n.id} (${why}); valid ${validity(n)}: ${truncate(n.itemE, 200)}`;
}

export function notamToJson(n: Notam | NotamHit) {
  return {
    ...n,
    validFrom: n.validFrom ? n.validFrom.toISOString() : null,
    validTo: n.validTo === 'PERM' ? 'PERM' : n.validTo ? n.validTo.toISOString() : null,
  };
}
