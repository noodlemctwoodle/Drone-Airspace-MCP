#!/usr/bin/env tsx
/**
 * Export a built pack as SQL for Cloudflare D1:
 *   tsx scripts/export-d1.ts build/pack/<tag>.sqlite --out build/d1.sql
 *   npx wrangler d1 execute uk-drone-airspace --remote --file build/d1.sql
 *
 * D1 cannot import virtual tables from a .dump, so base tables carry their
 * bboxes and the rtree / FTS5 tables are rebuilt with INSERT ... SELECT at the end.
 * Statements stay under D1's 100 KB statement limit.
 */
import { createWriteStream } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDatabase } from '../src/pack/driver.js';
import { DDL, SPATIAL_TABLES } from '../src/pack/schema.js';

const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: { out: { type: 'string', default: 'build/d1.sql' } }, allowPositionals: true });
const packPath = positionals[0];
if (!packPath) {
  console.error('usage: export-d1.ts <pack.sqlite> [--out build/d1.sql]');
  process.exit(2);
}

const BASE_TABLES = ['meta', 'sources', 'authorities', 'zones', 'rights_of_way', 'land_restrictions', 'coverage', 'gazetteer'] as const;
const MAX_STATEMENT_BYTES = 60_000;

function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

const db = openDatabase(packPath, { readonly: true });
const out = createWriteStream(values.out ?? 'build/d1.sql');
const write = (s: string) => out.write(`${s}\n`);

// Drop everything (virtual tables first, then base tables), then recreate from the shared DDL.
for (const t of SPATIAL_TABLES) write(`DROP TABLE IF EXISTS ${t}_rtree;`);
write('DROP TABLE IF EXISTS gazetteer_fts;');
for (const t of [...BASE_TABLES].reverse()) write(`DROP TABLE IF EXISTS ${t};`);
for (const stmt of DDL) write(`${stmt.replace(/\s+/g, ' ').trim()};`);

let total = 0;
for (const table of BASE_TABLES) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => String(r.name));
  const rows = db.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all();
  const head = `INSERT INTO ${table} (${cols.join(', ')}) VALUES `;
  let buf: string[] = [];
  let size = head.length;
  const flush = () => {
    if (buf.length === 0) return;
    write(`${head}${buf.join(',')};`);
    total += buf.length;
    buf = [];
    size = head.length;
  };
  let skipped = 0;
  for (const row of rows) {
    const tuple = `(${cols.map((c) => literal(row[c])).join(',')})`;
    if (tuple.length > MAX_STATEMENT_BYTES) {
      // Would exceed D1's per-statement limit on its own; the pipeline splits multipolygons so this should not happen.
      skipped += 1;
      console.error(`[export-d1] WARN ${table} row ${String(row.id ?? row.key ?? '?')} is ${tuple.length} bytes; skipped`);
      continue;
    }
    if (size + tuple.length + 1 > MAX_STATEMENT_BYTES) flush();
    buf.push(tuple);
    size += tuple.length + 1;
  }
  flush();
  console.error(`[export-d1] ${table}: ${rows.length} rows${skipped ? ` (${skipped} skipped as oversize)` : ''}`);
}
for (const t of SPATIAL_TABLES) write(`INSERT INTO ${t}_rtree (id, min_lon, max_lon, min_lat, max_lat) SELECT id, min_lon, max_lon, min_lat, max_lat FROM ${t};`);
write(`INSERT INTO gazetteer_fts(gazetteer_fts) VALUES('rebuild');`);
out.end(() => console.error(`[export-d1] wrote ${values.out} (${total} rows)`));
db.close();
