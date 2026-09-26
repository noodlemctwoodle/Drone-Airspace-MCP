#!/usr/bin/env tsx
/**
 * Export a built pack as SQL for Cloudflare D1:
 *   tsx scripts/export-d1.ts build/pack/<tag>.sqlite --out build/d1.sql
 *   npx wrangler d1 execute uk-drone-airspace --remote --file build/d1.sql
 *
 * D1 cannot import virtual tables from a .dump, so base tables carry their
 * bboxes and the rtree / FTS5 tables are rebuilt with INSERT ... SELECT at the end.
 * Statements stay under D1's 100 KB statement limit.
 *
 * A national pack is too large for one remote import (D1 times out and rolls
 * back), so `--parts <dir>` writes numbered files of at most PART_BYTES each
 * with the rtree rebuilds chunked by id; `scripts/d1-load.sh` runs them in order.
 */
import { createWriteStream, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { openDatabase } from '../src/pack/driver.js';
import { DDL, SPATIAL_TABLES } from '../src/pack/schema.js';

const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: { out: { type: 'string', default: 'build/d1.sql' }, parts: { type: 'string' } }, allowPositionals: true });
const packPath = positionals[0];
if (!packPath) {
  console.error('usage: export-d1.ts <pack.sqlite> [--out build/d1.sql | --parts build/d1-parts]');
  process.exit(2);
}

const BASE_TABLES = ['meta', 'sources', 'authorities', 'zones', 'rights_of_way', 'land_restrictions', 'coverage', 'parking', 'hazards', 'admin_areas', 'gazetteer'] as const;
const MAX_STATEMENT_BYTES = 60_000;
/** Largest SQL file per remote import; well under what made D1 time out (425 MB in one go). */
const PART_BYTES = 80 * 1024 * 1024;
/** Rows per rtree rebuild statement. */
const RTREE_CHUNK = 100_000;

function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

const db = openDatabase(packPath, { readonly: true });

// One output stream, or a sequence of part files that roll over at PART_BYTES.
const partsDir = values.parts;
let partIndex = 0;
let partBytes = 0;
let out = partsDir ? null : createWriteStream(values.out ?? 'build/d1.sql');
if (partsDir) {
  mkdirSync(partsDir, { recursive: true });
  for (const f of readdirSync(partsDir)) if (/^\d{3}-.*\.sql$/.test(f)) unlinkSync(path.join(partsDir, f));
}
function openPart(label: string): void {
  if (!partsDir) return;
  out?.end();
  partIndex += 1;
  partBytes = 0;
  const name = `${String(partIndex).padStart(3, '0')}-${label}.sql`;
  out = createWriteStream(path.join(partsDir, name));
  console.error(`[export-d1] part ${name}`);
}
let currentLabel = 'schema';
const write = (s: string) => {
  if (partsDir && (!out || partBytes + s.length > PART_BYTES)) openPart(currentLabel);
  if (!out) throw new Error('no output stream open');
  partBytes += s.length + 1;
  out.write(`${s}\n`);
};

// Drop everything (virtual tables first, then base tables), then recreate from the shared DDL.
for (const t of SPATIAL_TABLES) write(`DROP TABLE IF EXISTS ${t}_rtree;`);
write('DROP TABLE IF EXISTS gazetteer_fts;');
for (const t of [...BASE_TABLES].reverse()) write(`DROP TABLE IF EXISTS ${t};`);
for (const stmt of DDL) write(`${stmt.replace(/\s+/g, ' ').trim()};`);

let total = 0;
for (const table of BASE_TABLES) {
  currentLabel = table;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => String(r.name));
  const rows = db.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all();
  if (partsDir && rows.length > 10_000 && partBytes > 0) openPart(table); // a big table starts in its own file
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
// Index rebuilds: every remote import runs as one transaction and D1 times out
// on a few million rtree inserts at once, so in parts mode each file rebuilds at
// most ROWS_PER_INDEX_PART rows and the FTS rebuild has a file of its own.
const ROWS_PER_INDEX_PART = 200_000;
for (const t of SPATIAL_TABLES) {
  currentLabel = `indexes-${t}`;
  const maxId = Number(db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${t}`).get()?.m ?? 0);
  if (maxId === 0) continue;
  for (let lo = 0; lo < maxId; lo += RTREE_CHUNK) {
    if (partsDir && lo % ROWS_PER_INDEX_PART === 0) openPart(currentLabel);
    write(`INSERT INTO ${t}_rtree (id, min_lon, max_lon, min_lat, max_lat) SELECT id, min_lon, max_lon, min_lat, max_lat FROM ${t} WHERE id > ${lo} AND id <= ${lo + RTREE_CHUNK};`);
  }
}
currentLabel = 'indexes-fts';
if (partsDir) openPart(currentLabel);
write(`INSERT INTO gazetteer_fts(gazetteer_fts) VALUES('rebuild');`);
if (!out) throw new Error('no output stream open');
out.end(() => console.error(`[export-d1] wrote ${partsDir ? `${partIndex} parts in ${partsDir}` : values.out} (${total} rows)`));
db.close();
