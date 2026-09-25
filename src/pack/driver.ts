import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';

export type Row = Record<string, SQLOutputValue>;
export type Params = SQLInputValue[];

export interface Statement {
  get(...params: Params): Row | undefined;
  all(...params: Params): Row[];
  run(...params: Params): { changes: number | bigint; lastInsertRowid: number | bigint };
}

/**
 * The narrow surface the rest of the code uses. Implemented over Node's built-in
 * `node:sqlite` so that `npx` users need no native module. Swapping in
 * better-sqlite3 means implementing these six members only.
 */
export interface SqliteDriver {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma<T = SQLOutputValue>(name: string): T | undefined;
  transaction<T>(fn: () => T): T;
  close(): void;
  readonly path: string;
}

export interface OpenOptions {
  readonly?: boolean;
}

class NodeSqliteDriver implements SqliteDriver {
  private readonly db: DatabaseSync;
  private readonly cache = new Map<string, Statement>();

  constructor(
    public readonly path: string,
    options: OpenOptions = {}
  ) {
    this.db = new DatabaseSync(path, { readOnly: options.readonly ?? false });
  }

  prepare(sql: string): Statement {
    let stmt = this.cache.get(sql);
    if (!stmt) {
      const raw = this.db.prepare(sql);
      stmt = {
        get: (...params) => raw.get(...params) as Row | undefined,
        all: (...params) => raw.all(...params) as Row[],
        run: (...params) => raw.run(...params),
      };
      this.cache.set(sql, stmt);
    }
    return stmt;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma<T = SQLOutputValue>(name: string): T | undefined {
    const row = this.db.prepare(`PRAGMA ${name}`).get() as Row | undefined;
    if (!row) return undefined;
    const first = Object.values(row)[0];
    return first as T;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
      throw error;
    }
  }

  close(): void {
    this.cache.clear();
    this.db.close();
  }
}

export function openDatabase(path: string, options: OpenOptions = {}): SqliteDriver {
  return new NodeSqliteDriver(path, options);
}

export interface SqliteCapabilities {
  version: string;
  rtree: boolean;
  fts5: boolean;
  json: boolean;
}

/** Runtime self-check: confirms the bundled SQLite has what the pack needs. */
export function sqliteCapabilities(): SqliteCapabilities {
  const db = new DatabaseSync(':memory:');
  const version = String((db.prepare('SELECT sqlite_version() AS v').get() as Row).v);
  const has = (sql: string) => {
    try {
      db.exec(sql);
      return true;
    } catch {
      return false;
    }
  };
  const caps = {
    version,
    rtree: has('CREATE VIRTUAL TABLE t_rtree USING rtree(id, minx, maxx, miny, maxy)'),
    fts5: has('CREATE VIRTUAL TABLE t_fts USING fts5(x)'),
    json: has(`SELECT json_extract('{"a":1}', '$.a')`),
  };
  db.close();
  return caps;
}
