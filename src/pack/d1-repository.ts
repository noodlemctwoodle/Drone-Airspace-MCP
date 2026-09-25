import type { Row } from './driver.js';
import type { AsyncQuery, SqlValue } from './query.js';
import { QueryPackRepository } from './repository.js';

/** The subset of Cloudflare's D1Database API this adapter uses. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): { all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>; first<T = Record<string, unknown>>(): Promise<T | null> };
  };
}

export class D1Query implements AsyncQuery {
  constructor(private readonly db: D1Like) {}
  async all(sql: string, params: SqlValue[] = []): Promise<Row[]> {
    const res = await this.db.prepare(sql).bind(...params).all<Row>();
    return res.results ?? [];
  }
  async get(sql: string, params: SqlValue[] = []): Promise<Row | undefined> {
    const row = await this.db.prepare(sql).bind(...params).first<Row>();
    return row ?? undefined;
  }
  close(): void {
    // D1 bindings have no connection to close.
  }
}

export class D1PackRepository extends QueryPackRepository {
  constructor(db: D1Like) {
    super(new D1Query(db));
  }
}
