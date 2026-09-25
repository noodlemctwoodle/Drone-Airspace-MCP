import type { Position } from '../../types.js';

export const NM_TO_KM = 1.852;
export const WHOLE_FIR_RADIUS_NM = 999;

/** `5408N00316W` -> [lon, lat]. Returns undefined for anything else. */
export function parseCoordinates(text: string | null | undefined): Position | undefined {
  if (!text) return undefined;
  const m = /^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])$/.exec(text.trim());
  if (!m) return undefined;
  const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3] === 'S' ? -1 : 1);
  const lon = (Number(m[4]) + Number(m[5]) / 60) * (m[6] === 'W' ? -1 : 1);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return [lon, lat];
}

/** Traditional single-line Q field, e.g. EGTT/QRTCA/IV/BO/W/000/020/5130N00030W005 */
export const Q_LINE_TEXT =
  /([A-Z]{4})\/(Q[A-Z]{4})\/(IV|I|V)\/([A-Z]{1,4})\/([A-Z]{1,4})\/(\d{3})\/(\d{3})\/(\d{2}\d{2}[NS]\d{3}\d{2}[EW])(\d{3})/;

export interface QLineText {
  fir: string;
  qCode: string;
  traffic: string;
  purpose: string;
  scope: string;
  lowerFl: number;
  upperFl: number;
  centre: Position | undefined;
  radiusNm: number;
}

export function parseQLineText(text: string | null | undefined): QLineText | undefined {
  if (!text) return undefined;
  const m = Q_LINE_TEXT.exec(text);
  if (!m) return undefined;
  return {
    fir: m[1],
    qCode: m[2],
    traffic: m[3],
    purpose: m[4],
    scope: m[5],
    lowerFl: Number(m[6]),
    upperFl: Number(m[7]),
    centre: parseCoordinates(m[8]),
    radiusNm: Number(m[9]),
  };
}

/**
 * Item E often carries a more precise position and radius than the Q-line,
 * e.g. "WI 0.1NM RADIUS OF 540831.88N 0031356.82W" or "WI 4NM RADIUS OF 540301N 0031407W".
 */
export function parseItemEPosition(itemE: string | null | undefined): { centre: Position; radiusNm: number } | undefined {
  if (!itemE) return undefined;
  const text = itemE.replace(/\s+/g, ' ');
  const m =
    /(?:WI|WITHIN)\s+(\d+(?:\.\d+)?)\s*(NM|KM|M)\s+(?:RADIUS\s+)?(?:OF|CENTRED\s+ON)?\s*(\d{2})(\d{2})(\d{2}(?:\.\d+)?)?\s*([NS])\s*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)?\s*([EW])/i.exec(text);
  if (!m) return undefined;
  const value = Number(m[1]);
  const unit = m[2].toUpperCase();
  const radiusNm = unit === 'NM' ? value : unit === 'KM' ? value / NM_TO_KM : value / 1852;
  const lat = (Number(m[3]) + Number(m[4]) / 60 + (m[5] ? Number(m[5]) / 3600 : 0)) * (m[6].toUpperCase() === 'S' ? -1 : 1);
  const lon = (Number(m[7]) + Number(m[8]) / 60 + (m[9] ? Number(m[9]) / 3600 : 0)) * (m[10].toUpperCase() === 'W' ? -1 : 1);
  if (!Number.isFinite(radiusNm) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { centre: [lon, lat], radiusNm };
}
