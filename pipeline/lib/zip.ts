import { unzipSync } from 'fflate';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function readZipEntries(buffer: Buffer | Uint8Array): ZipEntry[] {
  const files = unzipSync(buffer instanceof Buffer ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : buffer);
  return Object.entries(files).map(([name, data]) => ({ name, data }));
}

export function pickEntry(entries: ZipEntry[], pattern: RegExp): ZipEntry {
  const candidates = entries.filter((e) => pattern.test(e.name)).sort((a, b) => b.data.length - a.data.length);
  if (candidates.length === 0) throw new Error(`no zip entry matches ${pattern}; entries: ${entries.map((e) => e.name).join(', ')}`);
  return candidates[0];
}

export function entryText(entry: ZipEntry): string {
  return Buffer.from(entry.data).toString('utf8');
}
