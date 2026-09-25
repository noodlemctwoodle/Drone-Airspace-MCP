import type { ArcgisFeature, NormalisedRestriction } from '../nt/arcgis.js';
import { firstString, isPolygonal, tidyLandGeometry } from './shared.js';

/**
 * Natural England open data (OGL v3): CRoW Act 2000 access land, Sites of
 * Special Scientific Interest and National Parks. Access land is context for
 * take-off, not permission; the designations are advisory.
 */
export const NE_CROW_URL = 'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/CRoW_Act_2000_Access_Layer/FeatureServer/0';
export const NE_SSSI_URL = 'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/SSSI_England/FeatureServer/0';
export const NE_NATIONAL_PARKS_URL = 'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/National_Parks_England/FeatureServer/0';

export const ACCESS_LAND_SUMMARY =
  'Open access land under the CRoW Act 2000: the public may walk here off paths. The access right does not itself ban take-off, but landowner byelaws and any local restriction still apply, and the right can be withdrawn on set days.';
export const SSSI_SUMMARY =
  'Site of Special Scientific Interest: intentionally or recklessly disturbing protected wildlife is an offence (Wildlife and Countryside Act 1981 s.28P); keep well away from nesting birds, seal haul-outs and livestock, and check for site-specific byelaws.';
export const NATIONAL_PARK_SUMMARY =
  'National Park: no blanket drone ban, but the park authority manages land with its own byelaws and asks pilots to follow its drone guidance.';
export const NE_ACCESS_INFO_URL = 'https://www.gov.uk/right-of-way-open-access-land/use-your-right-to-roam';

const yes = (v: unknown) => typeof v === 'string' && /^y/i.test(v.trim());

export function normaliseCrowFeature(f: ArcgisFeature, fetchedAt: string, simplifyM = 10): NormalisedRestriction | undefined {
  if (!isPolygonal(f.geometry)) return undefined;
  const props = f.properties ?? {};
  const accessClass = yes(props.RCL) ? 'common_land' : yes(props.S16) ? 'dedicated' : 'open_country';
  const id = props.OBJECTID ?? f.id;
  return {
    sourceId: 'ne_crow_access',
    entryId: id === undefined || id === null ? null : String(id),
    kind: 'access_land',
    owner: 'Natural England',
    name: accessClass === 'common_land' ? 'Registered common land' : accessClass === 'dedicated' ? 'Dedicated access land' : 'Open country',
    accessClass,
    takeoffBanned: false,
    landingBanned: false,
    summary: ACCESS_LAND_SUMMARY,
    sourceUrl: NE_ACCESS_INFO_URL,
    lastVerified: fetchedAt.slice(0, 10),
    props: { version: props.Version ?? null },
    scope: 'site',
    geometry: tidyLandGeometry(f.geometry, simplifyM),
  };
}

export function normaliseSssiFeature(f: ArcgisFeature, fetchedAt: string, simplifyM = 10): NormalisedRestriction | undefined {
  if (!isPolygonal(f.geometry)) return undefined;
  const props = f.properties ?? {};
  const name = firstString(props, ['NAME', 'LABEL', 'sssi_name']) ?? 'Site of Special Scientific Interest';
  const ref = firstString(props, ['REF_CODE', 'sssi_code']);
  const hyperlink = firstString(props, ['HYPERLINK']);
  return {
    sourceId: 'ne_sssi',
    entryId: ref ?? (props.OBJECTID === undefined ? null : String(props.OBJECTID)),
    kind: 'designation',
    owner: 'Natural England',
    name: name.replace(/\s*\(SSSI\)\s*$/i, '').replace(/\s+SSSI$/i, ''),
    accessClass: 'sssi',
    takeoffBanned: false,
    landingBanned: null,
    summary: SSSI_SUMMARY,
    sourceUrl: hyperlink ? `https://designatedsites.naturalengland.org.uk/SiteDetail.aspx?SiteCode=S${hyperlink}` : 'https://designatedsites.naturalengland.org.uk/',
    lastVerified: fetchedAt.slice(0, 10),
    props: null,
    scope: 'site',
    geometry: tidyLandGeometry(f.geometry, simplifyM),
  };
}

export function normaliseNationalParkFeature(f: ArcgisFeature, fetchedAt: string, simplifyM = 20): NormalisedRestriction | undefined {
  if (!isPolygonal(f.geometry)) return undefined;
  const props = f.properties ?? {};
  const raw = firstString(props, ['NAME', 'np_name']) ?? 'National Park';
  const name = raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const link = firstString(props, ['HOTLINK', 'metadata']);
  return {
    sourceId: 'ne_national_parks',
    entryId: props.CODE === undefined ? null : String(props.CODE),
    kind: 'designation',
    owner: `${name} National Park Authority`,
    name: `${name} National Park`,
    accessClass: 'national_park',
    takeoffBanned: false,
    landingBanned: null,
    summary: NATIONAL_PARK_SUMMARY,
    sourceUrl: link && /^https?:/.test(link) ? link : 'https://www.nationalparks.uk/',
    lastVerified: fetchedAt.slice(0, 10),
    props: null,
    scope: 'site',
    geometry: tidyLandGeometry(f.geometry, simplifyM),
  };
}
