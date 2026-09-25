import type { PackMeta } from '../types.js';

export type SourceId = 'airspace' | 'prow' | 'landowner' | 'byelaws' | 'nominatim' | 'os_names' | 'postcodes_io' | 'notam' | 'coverage' | 'parking' | 'weather' | 'caa_rules' | 'elevation' | 'space_weather' | 'hazards' | 'lad' | 'access_land' | 'designations' | 'forestry';

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
  lad: ['ons_lad'],
  access_land: ['ne_crow_access', 'nrw_open_country', 'nrw_common_land'],
  designations: ['ne_sssi', 'nrw_sssi', 'ne_national_parks', 'nrw_national_parks'],
  forestry: ['fe_legal_boundary'],
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
  lad: 'ONS boundaries',
  access_land: 'Natural England and Natural Resources Wales access land',
  designations: 'SSSI and National Park boundaries',
  forestry: 'Forestry England',
};

/** One short spoken sentence naming the sources used. */
export function attributionSentence(used: Iterable<SourceId>): string {
  const names = [...new Set([...used].map((u) => SHORT[u]).filter(Boolean))];
  return names.length > 0 ? `Sources: ${names.join(', ')}.` : '';
}

/**
 * Attribution strings for the sources used. A group such as `access_land` maps
 * to several pack sources; pass `packIds` (the source ids of the rows actually
 * returned) to name only those rather than every source in the group.
 */
export function attributionLines(used: Iterable<SourceId>, meta: PackMeta | null, packIds?: Iterable<string>): string[] {
  const only = packIds ? new Set(packIds) : null;
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
    const groupIds = PACK_SOURCE_IDS[id] ?? [];
    for (const packId of groupIds) {
      if (only && only.size > 0 && !only.has(packId) && groupIds.length > 1) continue;
      const source = meta?.sources.find((s) => s.id === packId);
      if (source) push(source.attribution);
    }
  }
  return lines;
}
