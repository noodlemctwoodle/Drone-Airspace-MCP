import type { ArcgisFeature, NormalisedRestriction } from '../nt/arcgis.js';
import { isPolygonal, tidyLandGeometry } from '../access/shared.js';

/** Forestry England legal boundary (OGL v3 with a mandatory acknowledgement). Its byelaws need a permit for any drone use. */
export const FE_LEGAL_BOUNDARY_URL = 'https://services2.arcgis.com/mHXjwgl3OARRqqD4/arcgis/rest/services/Forestry_England_Legal_Boundary_2024/FeatureServer/0';
export const FE_POLICY_URL = 'https://www.forestryengland.uk/article/filming-photography-and-drones';
export const FE_SUMMARY = 'Forestry England byelaws prohibit operating any aircraft, including drones, on the land it manages without a permit; apply at least eight weeks ahead.';
export const FE_ATTRIBUTION =
  'Forestry England land: Forestry England Legal Boundary, Open Government Licence v3. Contains, or is based on, information supplied by the Forestry Commission. © Crown copyright and database right 2026 Ordnance Survey [100021242].';

export function normaliseForestryFeature(f: ArcgisFeature, fetchedAt: string, simplifyM = 10): NormalisedRestriction | undefined {
  if (!isPolygonal(f.geometry)) return undefined;
  const props = f.properties ?? {};
  const id = props.OBJECTID ?? f.id;
  return {
    sourceId: 'fe_legal_boundary',
    entryId: id === undefined || id === null ? null : String(id),
    kind: 'landowner',
    owner: 'Forestry England',
    name: 'Forestry England land',
    accessClass: 'forestry',
    takeoffBanned: true,
    landingBanned: true,
    summary: FE_SUMMARY,
    sourceUrl: FE_POLICY_URL,
    lastVerified: fetchedAt.slice(0, 10),
    props: props.cost_centre === undefined ? null : { costCentre: props.cost_centre },
    scope: 'site',
    geometry: tidyLandGeometry(f.geometry, simplifyM),
  };
}
