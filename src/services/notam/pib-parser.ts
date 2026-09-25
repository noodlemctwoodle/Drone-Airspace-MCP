import { XMLParser } from 'fast-xml-parser';
import type { Notam } from '../../types.js';
import { PIB_ARRAY_ELEMENTS, PIB_EL } from './pib-schema.js';
import { NM_TO_KM, WHOLE_FIR_RADIUS_NM, parseCoordinates, parseItemEPosition, parseQLineText } from './q-line.js';
import { parseNotamTime } from './validity.js';

export interface ParsedBulletin {
  notams: Notam[];
  validFrom: Date | null;
  validTo: Date | null;
  issued: Date | null;
  stats: { elements: number; unique: number; skipped: number };
}

type Node = Record<string, unknown>;

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(' ') || null;
  if (typeof v === 'object' && '#text' in (v as Node)) return text((v as Node)['#text']);
  return null;
}

function texts(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map(text).filter((s): s is string => !!s);
  const t = text(v);
  return t ? [t] : [];
}

function num(v: unknown): number | null {
  const t = text(v);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Recursively collect every element named `name` anywhere in the tree. */
function collect(node: unknown, name: string, out: Node[] = []): Node[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, name, out);
    return out;
  }
  for (const [key, value] of Object.entries(node as Node)) {
    if (key === name) {
      if (Array.isArray(value)) out.push(...(value as Node[]));
      else if (value && typeof value === 'object') out.push(value as Node);
    } else if (value && typeof value === 'object') {
      collect(value, name, out);
    }
  }
  return out;
}

function parseOne(n: Node): Notam | undefined {
  const series = text(n[PIB_EL.SERIES]);
  const number = text(n[PIB_EL.NUMBER]);
  const year = text(n[PIB_EL.YEAR]);
  const itemE = text(n[PIB_EL.ITEM_E]);
  if (!itemE && !(series && number)) return undefined;
  const id = series && number ? `${series}${number}/${year ?? ''}` : `unknown-${Math.random().toString(36).slice(2, 8)}`;

  const q = (n[PIB_EL.QLINE] ?? {}) as Node;
  let fir = text(q[PIB_EL.FIR]);
  let qCode = text(q[PIB_EL.CODE23]) && text(q[PIB_EL.CODE45]) ? `Q${text(q[PIB_EL.CODE23])}${text(q[PIB_EL.CODE45])}` : null;
  let traffic = text(q[PIB_EL.TRAFFIC]);
  let purpose = text(q[PIB_EL.PURPOSE]);
  let scope = text(q[PIB_EL.SCOPE]);
  let lowerFl = num(q[PIB_EL.LOWER]);
  let upperFl = num(q[PIB_EL.UPPER]);
  let centre = parseCoordinates(text(n[PIB_EL.COORDINATES]));
  let radiusNm = num(n[PIB_EL.RADIUS]);

  // Fallback for a feed that switched to a single textual Q line.
  if (!fir && !centre) {
    const qt = parseQLineText(text(n[PIB_EL.QLINE]) ?? itemE);
    if (qt) {
      fir = qt.fir;
      qCode = qt.qCode;
      traffic = qt.traffic;
      purpose = qt.purpose;
      scope = qt.scope;
      lowerFl = qt.lowerFl;
      upperFl = qt.upperFl;
      centre = qt.centre;
      radiusNm = qt.radiusNm;
    }
  }

  let centreSource: Notam['centreSource'] = centre ? 'qline' : null;
  const precise = parseItemEPosition(itemE);
  if (precise && (radiusNm === null || precise.radiusNm <= radiusNm)) {
    centre = precise.centre;
    radiusNm = precise.radiusNm;
    centreSource = 'itemE';
  }
  const wholeFir = radiusNm !== null && radiusNm >= WHOLE_FIR_RADIUS_NM;

  const start = parseNotamTime(text(n[PIB_EL.START]));
  const end = parseNotamTime(text(n[PIB_EL.END]));
  const type = text(n[PIB_EL.TYPE]);

  return {
    id,
    series,
    number,
    year,
    fir,
    qCode,
    traffic,
    purpose,
    scope,
    lowerFl,
    upperFl,
    centre: centre ?? null,
    radiusNm,
    radiusKm: radiusNm === null ? null : Math.round(radiusNm * NM_TO_KM * 100) / 100,
    centreSource,
    wholeFir,
    validFrom: start instanceof Date ? start : null,
    validTo: end ?? null,
    estimated: text(n[PIB_EL.ESTIMATION])?.toUpperCase() === 'EST',
    schedule: text(n[PIB_EL.ITEM_D]),
    itemA: texts(n[PIB_EL.ITEM_A]).join(' ') || null,
    itemE: itemE ?? '',
    itemF: text(n[PIB_EL.ITEM_F]),
    itemG: text(n[PIB_EL.ITEM_G]),
    cancelled: type === 'C',
  };
}

function headerDate(root: Node, ...path: string[]): Date | null {
  let cur: unknown = root;
  for (const p of path) {
    if (!cur || typeof cur !== 'object') return null;
    cur = (cur as Node)[p];
  }
  const t = text(cur);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse the whole bulletin. Defensive by design: a malformed NOTAM is skipped
 * and counted, never thrown; garbage input yields an empty bulletin.
 */
export function parsePib(xml: string): ParsedBulletin {
  const empty: ParsedBulletin = { notams: [], validFrom: null, validTo: null, issued: null, stats: { elements: 0, unique: 0, skipped: 0 } };
  if (!xml || typeof xml !== 'string') return empty;
  let doc: Node;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      isArray: (name) => PIB_ARRAY_ELEMENTS.has(name),
    });
    doc = parser.parse(xml) as Node;
  } catch {
    return empty;
  }
  const root = (doc[PIB_EL.ROOT] ?? doc) as Node;
  const elements = collect(root, PIB_EL.NOTAM);
  const byId = new Map<string, Notam>();
  let skipped = 0;
  for (const el of elements) {
    try {
      const n = parseOne(el);
      if (!n) {
        skipped += 1;
        continue;
      }
      // The same NOTAM appears under every aerodrome section it affects; keep one.
      if (!byId.has(n.id)) byId.set(n.id, n);
    } catch {
      skipped += 1;
    }
  }
  return {
    notams: [...byId.values()],
    validFrom: headerDate(root, PIB_EL.HEADER, PIB_EL.VALIDITY, PIB_EL.VALID_FROM),
    validTo: headerDate(root, PIB_EL.HEADER, PIB_EL.VALIDITY, PIB_EL.VALID_TO),
    issued: headerDate(root, PIB_EL.HEADER, PIB_EL.ISSUED),
    stats: { elements: elements.length, unique: byId.size, skipped },
  };
}
