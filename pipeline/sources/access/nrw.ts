import type { NormalisedRestriction } from '../nt/arcgis.js';
import type { WfsFeature } from '../wfs/geojson.js';
import { ACCESS_LAND_SUMMARY, NATIONAL_PARK_SUMMARY, SSSI_SUMMARY } from './natural-england.js';
import { firstString, isPolygonal, tidyLandGeometry } from './shared.js';

/**
 * Natural Resources Wales open data on DataMapWales (OGL v3), served by
 * GeoServer WFS. Layer names are versioned by NRW and overridable by env var.
 */
export const NRW_WFS_URL = 'https://datamap.gov.wales/geoserver/ows';
export const NRW_LAYERS = {
  openCountry: 'inspire-nrw:NRW_OPEN_COUNTRY_2014',
  commonLand: 'inspire-nrw:NRW_COMMON_LAND_2014',
  dedicated: 'inspire-nrw:NRW_OTHER_DEDICATED_LAND',
  sssi: 'inspire-nrw:NRW_SSSI',
  nationalParks: 'inspire-nrw:NRW_NATIONAL_PARK',
} as const;
export const NRW_ACCESS_INFO_URL = 'https://naturalresources.wales/days-out/recreation-and-access-policy-advice-and-guidance/managing-access/open-access-land/?lang=en';

export function normaliseNrwAccessFeature(f: WfsFeature, accessClass: 'open_country' | 'common_land' | 'dedicated', sourceId: string, fetchedAt: string, simplifyM = 10): NormalisedRestriction | undefined {
  if (!isPolygonal(f.geometry)) return undefined;
  const props = f.properties ?? {};
  const id = f.id ?? props.id ?? props.objectid;
  return {
    sourceId,
    entryId: id === undefined || id === null ? null : String(id),
    kind: 'access_land',
    owner: 'Natural Resources Wales',
    name: accessClass === 'common_land' ? 'Registered common land' : accessClass === 'dedicated' ? 'Dedicated access land' : 'Open country',
    accessClass,
    takeoffBanned: false,
    landingBanned: false,
    summary: ACCESS_LAND_SUMMARY,
    sourceUrl: NRW_ACCESS_INFO_URL,
    lastVerified: fetchedAt.slice(0, 10),
    props: null,
    scope: 'site',
    geometry: tidyLandGeometry(f.geometry, simplifyM),
  };
}

export function normaliseNrwSssiFeature(f: WfsFeature, fetchedAt: string, simplifyM = 10): NormalisedRestriction | undefined {
  if (!isPolygonal(f.geometry)) return undefined;
  const props = f.properties ?? {};
  const name = firstString(props, ['sssi_name', 'SSSI_NAME', 'name']) ?? 'Site of Special Scientific Interest';
  const code = firstString(props, ['sssi_code', 'SSSI_CODE']);
  return {
    sourceId: 'nrw_sssi',
    entryId: code ?? (f.id === undefined ? null : String(f.id)),
    kind: 'designation',
    owner: 'Natural Resources Wales',
    name,
    accessClass: 'sssi',
    takeoffBanned: false,
    landingBanned: null,
    summary: SSSI_SUMMARY,
    sourceUrl: 'https://naturalresources.wales/guidance-and-advice/environmental-topics/wildlife-and-biodiversity/find-protected-areas-of-land-and-seas/?lang=en',
    lastVerified: fetchedAt.slice(0, 10),
    props: null,
    scope: 'site',
    geometry: tidyLandGeometry(f.geometry, simplifyM),
  };
}

export function normaliseNrwNationalParkFeature(f: WfsFeature, fetchedAt: string, simplifyM = 20): NormalisedRestriction | undefined {
  if (!isPolygonal(f.geometry)) return undefined;
  const props = f.properties ?? {};
  const raw = firstString(props, ['np_name', 'NP_NAME', 'name']) ?? 'National Park';
  const name = raw.includes('/') ? raw.split('/').map((s) => s.trim()).join(' / ') : raw;
  return {
    sourceId: 'nrw_national_parks',
    entryId: props.isis_id === undefined ? null : String(props.isis_id),
    kind: 'designation',
    owner: `${name} National Park Authority`,
    name: `${name} National Park`,
    accessClass: 'national_park',
    takeoffBanned: false,
    landingBanned: null,
    summary: NATIONAL_PARK_SUMMARY,
    sourceUrl: 'https://www.nationalparks.uk/',
    lastVerified: fetchedAt.slice(0, 10),
    props: null,
    scope: 'site',
    geometry: tidyLandGeometry(f.geometry, simplifyM),
  };
}
