import proj4 from 'proj4';
import type { HttpClient } from '../../core/http-client.js';
import type { GeocodeCandidate } from '../../types.js';
import { clamp01, type GeocodeProvider } from './provider.js';

// OSGB36 / British National Grid with the standard Helmert parameters (accuracy a few metres).
const BNG =
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs';
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

export function bngToWgs84(easting: number, northing: number): { lon: number; lat: number } {
  const [lon, lat] = proj4(BNG, WGS84, [easting, northing]);
  return { lon, lat };
}

interface GazetteerEntry {
  NAME1?: string;
  NAME2?: string;
  TYPE?: string;
  LOCAL_TYPE?: string;
  GEOMETRY_X?: number;
  GEOMETRY_Y?: number;
  COUNTY_UNITARY?: string;
  DISTRICT_BOROUGH?: string;
  REGION?: string;
  COUNTRY?: string;
  POSTCODE_DISTRICT?: string;
  MBR_XMIN?: number;
  MBR_YMIN?: number;
  MBR_XMAX?: number;
  MBR_YMAX?: number;
}

interface OsNamesResponse {
  results?: Array<{ GAZETTEER_ENTRY?: GazetteerEntry }>;
}

export class OsNamesProvider implements GeocodeProvider {
  readonly name = 'os_names';

  constructor(
    private readonly http: HttpClient,
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  canHandle(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<GeocodeCandidate[]> {
    const url = `${this.baseUrl}?query=${encodeURIComponent(query)}&maxresults=${Math.min(10, Math.max(1, limit))}&key=${encodeURIComponent(this.apiKey)}`;
    const { data } = await this.http.getJson<OsNamesResponse>(url, { provider: this.name });
    const results = Array.isArray(data?.results) ? data.results : [];
    const out: GeocodeCandidate[] = [];
    for (const r of results) {
      const e = r?.GAZETTEER_ENTRY;
      if (!e || typeof e.GEOMETRY_X !== 'number' || typeof e.GEOMETRY_Y !== 'number' || !e.NAME1) continue;
      if ((e.LOCAL_TYPE ?? '').toLowerCase() === 'postcode') continue;
      const { lon, lat } = bngToWgs84(e.GEOMETRY_X, e.GEOMETRY_Y);
      const exact = e.NAME1.toLowerCase() === query.toLowerCase();
      const parts = [e.NAME1, e.LOCAL_TYPE, e.DISTRICT_BOROUGH ?? e.COUNTY_UNITARY, e.REGION].filter(
        (p): p is string => typeof p === 'string' && p.trim() !== ''
      );
      const candidate: GeocodeCandidate = {
        name: parts.join(', '),
        lat,
        lon,
        source: 'os_names',
        confidence: clamp01(exact ? 0.9 : 0.7),
        type: e.LOCAL_TYPE ?? e.TYPE,
      };
      if (
        typeof e.MBR_XMIN === 'number' &&
        typeof e.MBR_YMIN === 'number' &&
        typeof e.MBR_XMAX === 'number' &&
        typeof e.MBR_YMAX === 'number'
      ) {
        const sw = bngToWgs84(e.MBR_XMIN, e.MBR_YMIN);
        const ne = bngToWgs84(e.MBR_XMAX, e.MBR_YMAX);
        candidate.bbox = [sw.lon, sw.lat, ne.lon, ne.lat];
      }
      out.push(candidate);
    }
    return out;
  }
}
