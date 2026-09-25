import { rm } from 'node:fs/promises';
import { openDatabase, type SqliteDriver } from '../../src/pack/driver.js';
import { APPLICATION_ID, DDL, SCHEMA_VERSION } from '../../src/pack/schema.js';

export async function createPackDb(file: string): Promise<SqliteDriver> {
  await rm(file, { force: true });
  await rm(`${file}-journal`, { force: true });
  const db = openDatabase(file);
  db.exec('PRAGMA page_size = 4096');
  db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
  db.exec('PRAGMA journal_mode = OFF');
  db.exec('PRAGMA synchronous = OFF');
  db.exec('PRAGMA temp_store = MEMORY');
  db.exec('PRAGMA cache_size = -262144');
  for (const stmt of DDL) db.exec(stmt);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

export function finaliseDb(db: SqliteDriver): void {
  db.exec("INSERT INTO gazetteer_fts(gazetteer_fts) VALUES('rebuild')");
  db.exec('ANALYZE');
  db.exec('VACUUM');
}
