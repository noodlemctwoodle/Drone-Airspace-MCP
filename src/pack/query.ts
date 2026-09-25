import type { Row } from './driver.js';

export type SqlValue = string | number | null | bigint | Uint8Array;

/**
 * The only thing the repository needs from a database: run a parameterised
 * statement and get rows back. Implemented over node:sqlite (sync, wrapped)
 * and Cloudflare D1 (async).
 */
export interface AsyncQuery {
  all(sql: string, params?: SqlValue[]): Promise<Row[]>;
  get(sql: string, params?: SqlValue[]): Promise<Row | undefined>;
  close(): void;
}
