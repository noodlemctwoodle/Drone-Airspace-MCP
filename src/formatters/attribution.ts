import type { PackMeta } from '../types.js';

export type SourceId = 'airspace' | 'prow' | 'landowner' | 'byelaws' | 'nominatim' | 'os_names' | 'postcodes_io' | 'notam' | 'coverage' | 'parking' | 'weather' | 'caa_rules' | 'elevation' | 'space_weather' | 'hazards';

const LIVE: Record<string, string> = {
  nominatim: 'Geocoding © OpenStreetMap contributors (ODbL), via Nominatim',
  os_names: 'Geocoding: OS Names API, contains OS data © Crown copyright and database right (OGL v3)',
  postcodes_io: 'Postcode lookup: postcodes.io, contains OS and ONS data (OGL v3)',
  notam: 'NOTAMs: NATS AIS UK PIB (informational only; obtain an official pre-flight briefing)',
  weather: 'Weather: Open-Meteo.com (CC BY 4.0)',
  caa_rules: 'Drone rules: summary of UK CAA class mark and open category guidance (caa.co.uk, Crown copyright, OGL v3); the Drone Code and CAP 722 are authoritative',
  elevation: 'Elevation: Open-Meteo.com (CC BY 4.0), Copernicus GLO-90 DEM (European Union and ESA)',
  space_weather: 'Geomagnetic activity: NOAA Space Weather Prediction Center planetary K-index (US Government, public domain)',
};

const PACK_SOURCE_IDS: Record<string, string[]> = {
  airspace: ['nats_uas'],
  prow: ['rowmaps'],
  landowner: ['nt_always_open', 'nt_limited_access'],
  byelaws: ['byelaws'],
  coverage: ['ons_countries'],
  parking: ['osm_parking'],
  hazards: ['osm_hazards'],
};

const SHORT: Record<string, string> = {
  airspace: 'NATS UK AIP',
  prow: 'council rights of way data via rowmaps',
  landowner: 'National Trust open data',
  byelaws: 'the council byelaw list',
  coverage: 'ONS boundaries',
  parking: 'OpenStreetMap parking',
  nominatim: 'OpenStreetMap',
  os_names: 'Ordnance Survey',
  postcodes_io: 'postcodes.io',
  notam: 'the NATS NOTAM bulletin',
  weather: 'Open-Meteo',
  caa_rules: 'the CAA Drone Code',
  elevation: 'Open-Meteo elevation',
  space_weather: 'NOAA space weather',
  hazards: 'OpenStreetMap hazards',
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
