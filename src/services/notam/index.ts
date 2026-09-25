import distance from '@turf/distance';
import { point } from '@turf/helpers';
import type { Notam, NotamHit } from '../../types.js';
import type { PibFetcher } from './pib-fetcher.js';
import { parsePib, type ParsedBulletin } from './pib-parser.js';
import { isInForce } from './validity.js';

export interface NotamQuery {
  covering: NotamHit[];
  nearby: NotamHit[];
  unlocated: Notam[];
  bulletin: { fetchedAt: Date; ageSeconds: number; stale: boolean; lastError: string | null; count: number; validFrom: Date | null; validTo: Date | null };
}

export interface NotamStatus {
  url: string;
  ttlSeconds: number;
  lastError: string | null;
  cachedAt: Date | null;
  ageSeconds: number | null;
  count: number | null;
}

export class NotamService {
  private memo: { key: string; parsed: ParsedBulletin; fetchedAt: Date } | undefined;

  constructor(private readonly fetcher: PibFetcher) {}

  private async bulletin(): Promise<{ parsed: ParsedBulletin; fetchedAt: Date; ageSeconds: number; stale: boolean; lastError: string | null }> {
    const doc = await this.fetcher.fetch();
    const key = `${doc.fetchedAt.getTime()}:${doc.xml.length}`;
    if (!this.memo || this.memo.key !== key) {
      this.memo = { key, parsed: parsePib(doc.xml), fetchedAt: doc.fetchedAt };
    }
    return { parsed: this.memo.parsed, fetchedAt: doc.fetchedAt, ageSeconds: doc.ageSeconds, stale: doc.stale, lastError: doc.lastError };
  }

  async nearPoint(lon: number, lat: number, radiusKm: number, at: Date): Promise<NotamQuery> {
    const b = await this.bulletin();
    const pt = point([lon, lat]);
    const covering: NotamHit[] = [];
    const nearby: NotamHit[] = [];
    const unlocated: Notam[] = [];
    for (const n of b.parsed.notams) {
      if (n.cancelled) continue;
      if (!isInForce(n.validFrom, n.validTo, at)) continue;
      if (!n.centre || n.radiusKm === null || n.wholeFir) {
        unlocated.push(n);
        continue;
      }
      const d = distance(pt, point(n.centre), { units: 'kilometers' });
      const hit: NotamHit = { ...n, distanceKm: Math.round(d * 100) / 100 };
      if (d <= n.radiusKm) covering.push(hit);
      else if (d - n.radiusKm <= radiusKm) nearby.push(hit);
    }
    covering.sort((a, b2) => a.distanceKm - b2.distanceKm);
    nearby.sort((a, b2) => a.distanceKm - b2.distanceKm);
    return {
      covering,
      nearby,
      unlocated,
      bulletin: {
        fetchedAt: b.fetchedAt,
        ageSeconds: b.ageSeconds,
        stale: b.stale,
        lastError: b.lastError,
        count: b.parsed.notams.length,
        validFrom: b.parsed.validFrom,
        validTo: b.parsed.validTo,
      },
    };
  }

  status(): NotamStatus {
    const s = this.fetcher.status;
    return {
      url: s.url,
      ttlSeconds: s.ttlSeconds,
      lastError: s.lastError,
      cachedAt: this.memo?.fetchedAt ?? null,
      ageSeconds: this.memo ? Math.floor((Date.now() - this.memo.fetchedAt.getTime()) / 1000) : null,
      count: this.memo?.parsed.notams.length ?? null,
    };
  }
}
