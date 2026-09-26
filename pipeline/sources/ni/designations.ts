import type { Geometry } from 'geojson';
import type { NormalisedRestriction } from '../nt/arcgis.js';
import { firstString, isPolygonal, tidyLandGeometry } from '../access/shared.js';

/**
 * Northern Ireland Environment Agency (DAERA) open data on OpenDataNI, Open
 * Government Licence v3: Areas of Special Scientific Interest (the ASSI is
 * Northern Ireland's SSSI), Areas of Outstanding Natural Beauty and National
 * Nature Reserves. Static GeoJSON in WGS84, last revised in 2020; the download
 * needs a User-Agent or the portal answers 403.
 */
export interface NiDesignationLayer {
  key: 'assi' | 'aonb' | 'nnr';
  sourceId: string;
  name: string;
  url: string;
  datasetUrl: string;
  /** The revision date in the published file name; the portal has no edit metadata. */
  version: string;
  summary: string;
  label: string;
}

export const NI_ASSI_URL = 'https://admin.opendatani.gov.uk/dataset/c847a3b8-059e-43a3-86dc-2c71fbaea4b8/resource/175b432e-01df-4413-b265-4f85c97914d1/download/assi-updated-25aug2020.geojson';
export const NI_AONB_URL = 'https://admin.opendatani.gov.uk/dataset/f803cb72-e3d2-44df-8a0c-19a496bd7a5d/resource/00347e51-c3ca-46c0-a638-0b15b085060a/download/aonb-updated-27aug2020.geojson';
export const NI_NNR_URL = 'https://admin.opendatani.gov.uk/dataset/bc53911b-6004-4534-a678-c738951fb305/resource/2bcbdb07-1896-4ff2-ace1-ba7d7e70a0dc/download/national-nature-reserves-updated-27aug2020.geojson';

export const NI_OWNER = 'Northern Ireland Environment Agency';

export const NI_DESIGNATION_LAYERS: NiDesignationLayer[] = [
  {
    key: 'assi', sourceId: 'niea_assi', name: 'Areas of Special Scientific Interest (Northern Ireland)', url: process.env.NI_ASSI_URL ?? NI_ASSI_URL,
    datasetUrl: 'https://www.opendatani.gov.uk/dataset/areas-of-special-scientific-interest', version: '2020-08-25', label: 'Area of Special Scientific Interest',
    summary: 'Area of Special Scientific Interest, Northern Ireland\'s equivalent of an SSSI: intentionally or recklessly disturbing protected wildlife is an offence (Environment (Northern Ireland) Order 2002); keep well away from nesting birds, seal haul-outs and livestock.',
  },
  {
    key: 'aonb', sourceId: 'niea_aonb', name: 'Areas of Outstanding Natural Beauty (Northern Ireland)', url: process.env.NI_AONB_URL ?? NI_AONB_URL,
    datasetUrl: 'https://www.opendatani.gov.uk/dataset/areas-of-outstanding-natural-beauty', version: '2020-08-27', label: 'Area of Outstanding Natural Beauty',
    summary: 'Area of Outstanding Natural Beauty: no blanket drone ban, but a protected landscape whose management partnership asks visitors not to disturb wildlife or other people.',
  },
  {
    key: 'nnr', sourceId: 'niea_nnr', name: 'National Nature Reserves (Northern Ireland)', url: process.env.NI_NNR_URL ?? NI_NNR_URL,
    datasetUrl: 'https://www.opendatani.gov.uk/dataset/national-nature-reserves', version: '2020-08-27', label: 'National Nature Reserve',
    summary: 'National Nature Reserve managed by the Northern Ireland Environment Agency for protected wildlife: disturbing it is an offence and reserve rules apply, so ask NIEA before flying here.',
  },
];

export function normaliseNiDesignation(feature: { geometry?: Geometry | null; properties?: Record<string, unknown> | null }, layer: NiDesignationLayer, fetchedAt: string, simplifyM = 10): NormalisedRestriction | undefined {
  if (!isPolygonal(feature.geometry)) return undefined;
  const props = feature.properties ?? {};
  const name = firstString(props, ['NAME', 'Name', 'SITE_NAME']) ?? layer.label;
  const ref = firstString(props, ['REFERENCE', 'ID_REF', 'REF']);
  const county = firstString(props, ['COUNTY']);
  return {
    sourceId: layer.sourceId,
    entryId: ref ?? name,
    kind: 'designation',
    owner: NI_OWNER,
    name: name.replace(/\s+(ASSI|AONB|NNR)$/i, ''),
    accessClass: layer.key,
    takeoffBanned: false,
    landingBanned: null,
    summary: layer.summary,
    sourceUrl: layer.datasetUrl,
    lastVerified: fetchedAt.slice(0, 10),
    props: county ? { county } : null,
    scope: 'site',
    geometry: tidyLandGeometry(feature.geometry, layer.key === 'aonb' ? Math.max(simplifyM, 20) : simplifyM),
  };
}
