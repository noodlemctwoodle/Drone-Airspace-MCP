import area from '@turf/area';
import { polygon } from '@turf/helpers';
import type { NormalisedZone } from './aixm-parser.js';
import type { KmlZone } from './kml-parser.js';

export interface CrossCheckReport {
  aixmCount: number;
  kmlCount: number;
  matched: number;
  onlyInAixm: string[];
  onlyInKml: string[];
  areaOutliers: Array<{ designator: string; ratio: number }>;
  warnings: string[];
}

/**
 * The NATS KML repeats each polygon (an extruded copy and a flat copy), so
 * identical rings are counted once.
 */
function kmlArea(z: KmlZone): number {
  let total = 0;
  const seen = new Set<string>();
  for (const ring of z.rings) {
    const key = ring.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(';');
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      total += area(polygon([ring]));
    } catch {
      // skip unclosed / invalid rings
    }
  }
  return total;
}

export function crossCheck(aixm: NormalisedZone[], kml: KmlZone[], opts: { areaTolerance?: number } = {}): CrossCheckReport {
  const tol = opts.areaTolerance ?? 0.03;
  const byDesignator = new Map<string, KmlZone>();
  for (const k of kml) if (k.designator) byDesignator.set(k.designator, k);
  const report: CrossCheckReport = { aixmCount: aixm.length, kmlCount: kml.length, matched: 0, onlyInAixm: [], onlyInKml: [], areaOutliers: [], warnings: [] };
  const seen = new Set<string>();
  for (const z of aixm) {
    if (!z.designator) continue;
    const k = byDesignator.get(z.designator);
    if (!k) {
      report.onlyInAixm.push(z.designator);
      continue;
    }
    seen.add(z.designator);
    report.matched += 1;
    const a = area(z.geometry);
    const b = kmlArea(k);
    if (b > 0) {
      const ratio = a / b;
      if (Math.abs(ratio - 1) > tol) report.areaOutliers.push({ designator: z.designator, ratio: Math.round(ratio * 1000) / 1000 });
    }
  }
  for (const k of kml) if (k.designator && !seen.has(k.designator)) report.onlyInKml.push(k.designator);
  const unmatched = report.onlyInAixm.length + report.onlyInKml.length;
  if (unmatched > 0.02 * Math.max(1, report.kmlCount)) report.warnings.push(`${unmatched} zones unmatched between AIXM and KML`);
  if (report.areaOutliers.length > 0.03 * Math.max(1, report.matched)) report.warnings.push(`${report.areaOutliers.length} zones differ in area by more than ${tol * 100}% from the KML`);
  return report;
}
