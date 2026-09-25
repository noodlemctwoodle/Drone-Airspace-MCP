export interface KnownPoint {
  name: string;
  lon: number;
  lat: number;
  /** Only run when the pack bbox contains the point. */
  expect:
    | { layer: 'zones'; zoneType?: string; icao?: string; designatorPrefix?: string }
    | { layer: 'rights_of_way'; authorityCode?: string; withinMetres: number }
    | { layer: 'land_restrictions'; owner: string }
    | { layer: 'parking'; withinMetres: number }
    | { layer: 'hazards'; kind?: string; withinMetres: number }
    | { layer: 'admin_areas'; code: string }
    | { layer: 'none' };
}

export const KNOWN_POINTS: KnownPoint[] = [
  { name: 'Heathrow ARP inside EGLL FRZ', lon: -0.4614, lat: 51.47, expect: { layer: 'zones', zoneType: 'frz', icao: 'EGLL' } },
  { name: 'Gatwick ARP inside EGKK FRZ', lon: -0.1821, lat: 51.1537, expect: { layer: 'zones', zoneType: 'frz', icao: 'EGKK' } },
  { name: 'Exeter ARP inside EGTE FRZ', lon: -3.4137, lat: 50.7344, expect: { layer: 'zones', zoneType: 'frz', icao: 'EGTE' } },
  { name: 'Bristol ARP inside EGGD FRZ', lon: -2.7191, lat: 51.3827, expect: { layer: 'zones', zoneType: 'frz', icao: 'EGGD' } },
  { name: 'Hinkley Point inside a restricted/prohibited zone', lon: -3.1303, lat: 51.2085, expect: { layer: 'zones', designatorPrefix: 'EG' } },
  { name: 'Durdle Door footpath (Dorset)', lon: -2.277, lat: 50.6212, expect: { layer: 'rights_of_way', authorityCode: 'DT', withinMetres: 150 } },
  { name: 'Durdle Door car park', lon: -2.2765, lat: 50.6227, expect: { layer: 'parking', withinMetres: 1200 } },
  { name: 'Brownsea Island is National Trust', lon: -1.9737, lat: 50.6905, expect: { layer: 'land_restrictions', owner: 'National Trust' } },
  { name: 'Corfe Castle is National Trust', lon: -2.0577, lat: 50.6407, expect: { layer: 'land_restrictions', owner: 'National Trust' } },
  // Well beyond any UK danger area (offshore Cornwall zones stop around 7W).
  { name: 'Atlantic negative control', lon: -12.0, lat: 50.5, expect: { layer: 'none' } },
];
