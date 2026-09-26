#!/usr/bin/env tsx
/** Download the live PIB and print distinct element paths with counts and a sample, to spot feed changes. */
import { XMLParser } from 'fast-xml-parser';
import { parsePib } from '../src/services/notam/pib-parser.js';

const url = process.env.NOTAM_PIB_URL ?? 'https://pibs.nats.co.uk/operational/pibs/PIB.xml';
(async () => {
  const xml = await (await fetch(url, { headers: { 'User-Agent': 'fpv-airspace inspect-pib' } })).text();
  const doc = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml) as Record<string, unknown>;
  const counts = new Map<string, { n: number; sample: string }>();
  const walk = (node: unknown, p: string) => {
    if (Array.isArray(node)) return node.forEach((x) => walk(x, p));
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k.startsWith('@_')) continue;
        const key = `${p}/${k}`;
        const e = counts.get(key) ?? { n: 0, sample: '' };
        e.n += 1;
        if (!e.sample && typeof v === 'string') e.sample = v.slice(0, 60);
        counts.set(key, e);
        walk(v, key);
      }
    }
  };
  walk(doc, '');
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`${String(v.n).padStart(6)}  ${k}  ${v.sample}`);
  const parsed = parsePib(xml);
  console.log(`\nparsePib: ${parsed.stats.unique} unique NOTAMs from ${parsed.stats.elements} elements, ${parsed.stats.skipped} skipped`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
