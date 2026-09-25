import type { PackMeta } from '../types.js';

export type SourceId = 'airspace' | 'prow' | 'landowner' | 'byelaws' | 'nominatim' | 'os_names' | 'postcodes_io' | 'notam' | 'coverage';

const LIVE: Record<string, string> = {
  nominatim: 'Geocoding © OpenStreetMap contributors (ODbL), via Nominatim',
  os_names: 'Geocoding: OS Names API, contains OS data © Crown copyright and database right (OGL v3)',
  postcodes_io: 'Postcode lookup: postcodes.io, contains OS and ONS data (OGL v3)',
  notam: 'NOTAMs: NATS AIS UK PIB (informational only; obtain an official pre-flight briefing)',
};

const PACK_SOURCE_IDS: Record<string, string[]> = {
  airspace: ['nats_uas'],
  prow: ['rowmaps'],
  landowner: ['nt_always_open', 'nt_limited_access'],
  byelaws: ['byelaws'],
  coverage: ['ons_countries'],
};

const SHORT: Record<string, string> = {
  airspace: 'NATS UK AIP',
  prow: 'council rights of way data via rowmaps',
  landowner: 'National Trust open data',
  byelaws: 'the council byelaw list',
  coverage: 'ONS boundaries',
  nominatim: 'OpenStreetMap',
  os_names: 'Ordnance Survey',
  postcodes_io: 'postcodes.io',
  notam: 'the NATS NOTAM bulletin',
};

/** One short spoken sentence naming the sources used. */
export function attributionSentence(used: Iterable<SourceId>): string {
  const names = [...new Set([...used].map((u) => SHORT[u]).filter(Boolean))];
  return names.length > 0 ? `Sources: ${names.join(', ')}.` : '';
}

export function attributionLines(used: Iterable<SourceId>, meta: PackMeta | null): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (!seen.has(s)) {
      seen.add(s);
      lines.push(s);
    }
  };
  for (const id of used) {
    if (LIVE[id]) {
      push(LIVE[id]);
      continue;
    }
    const packIds = PACK_SOURCE_IDS[id] ?? [];
    for (const packId of packIds) {
      const source = meta?.sources.find((s) => s.id === packId);
      if (source) push(source.attribution);
    }
  }
  return lines;
}
