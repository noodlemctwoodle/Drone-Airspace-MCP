import type { SqliteDriver } from '../../src/pack/driver.js';

/**
 * One gazetteer row per aerodrome (linked to its FRZ circle when there is one,
 * otherwise the first component) plus one per non-aerodrome zone so
 * "Hinkley Point" or "D118" resolve too.
 */
export function buildGazetteer(db: SqliteDriver): number {
  const rows = db.prepare('SELECT id, name, designator, zone_type, raw_type, icao, aerodrome_name, centroid_lon, centroid_lat FROM zones ORDER BY id').all();
  const ins = db.prepare('INSERT INTO gazetteer (name, icao, kind, lon, lat, zone_id, aliases) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const byAerodrome = new Map<string, typeof rows>();
  let n = 0;
  db.transaction(() => {
    for (const r of rows) {
      const aerodrome = r.aerodrome_name ? String(r.aerodrome_name) : null;
      if (aerodrome) {
        const list = byAerodrome.get(aerodrome) ?? [];
        list.push(r);
        byAerodrome.set(aerodrome, list);
        continue;
      }
      const aliases = [String(r.designator ?? ''), String(r.name)].filter(Boolean).join(' ');
      ins.run(String(r.name), r.icao ? String(r.icao) : null, 'zone', Number(r.centroid_lon), Number(r.centroid_lat), Number(r.id), aliases);
      n += 1;
    }
    for (const [name, list] of byAerodrome) {
      const primary = list.find((r) => String(r.raw_type ?? '').endsWith('/FRZ')) ?? list[0];
      const icao = (list.find((r) => r.icao)?.icao as string | undefined) ?? null;
      const aliases = [...new Set(list.map((r) => String(r.designator ?? '')).filter(Boolean))].join(' ');
      ins.run(name, icao, 'aerodrome', Number(primary.centroid_lon), Number(primary.centroid_lat), Number(primary.id), `${aliases} ${icao ?? ''}`.trim());
      n += 1;
    }
  });
  return n;
}
