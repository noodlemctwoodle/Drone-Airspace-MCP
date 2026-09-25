import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

export async function openNdjsonWriter(file: string): Promise<{ write(obj: unknown): void; close(): Promise<void>; count: () => number }> {
  await mkdir(path.dirname(file), { recursive: true });
  const stream = createWriteStream(file, { encoding: 'utf8' });
  let n = 0;
  return {
    write: (obj) => {
      n += 1;
      stream.write(`${JSON.stringify(obj)}\n`);
    },
    close: () => new Promise((resolve, reject) => stream.end((err: unknown) => (err ? reject(err) : resolve()))),
    count: () => n,
  };
}

export async function* readNdjson<T>(file: string): AsyncGenerator<T> {
  const rl = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() === '') continue;
    yield JSON.parse(line) as T;
  }
}
