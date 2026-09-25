import { parseArgs } from 'node:util';
import path from 'node:path';
import type { PackSource } from '../../src/types.js';
import { resolveRegion, type Region } from './regions.js';

export interface PipelineArgs {
  region: Region;
  out: string;
  rawDir: string;
  normalisedDir: string;
  reportsDir: string;
  offline: boolean;
  skipFetch: boolean;
  tag: string | undefined;
  airac: string | undefined;
  strict: boolean;
  simplifyProwM: number;
  simplifyLandM: number;
  exclude: Set<string>;
  positionals: string[];
  keep: number;
  prefix: string;
  noManifest: boolean;
}

export function parsePipelineArgs(argv: string[]): PipelineArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      region: { type: 'string' },
      bbox: { type: 'string' },
      out: { type: 'string', default: 'build' },
      offline: { type: 'boolean', default: false },
      'skip-fetch': { type: 'boolean', default: false },
      tag: { type: 'string' },
      airac: { type: 'string' },
      strict: { type: 'boolean', default: false },
      'simplify-prow-m': { type: 'string' },
      'simplify-land-m': { type: 'string' },
      exclude: { type: 'string' },
      keep: { type: 'string', default: '6' },
      prefix: { type: 'string', default: 'pack-' },
      'no-manifest': { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  const out = path.resolve(values.out ?? 'build');
  return {
    region: resolveRegion(values.region, values.bbox),
    out,
    rawDir: path.join(out, 'raw'),
    normalisedDir: path.join(out, 'normalised'),
    reportsDir: path.join(out, 'reports'),
    offline: values.offline ?? false,
    skipFetch: values['skip-fetch'] ?? false,
    tag: values.tag,
    airac: values.airac,
    strict: values.strict ?? false,
    simplifyProwM: values['simplify-prow-m'] ? Number(values['simplify-prow-m']) : 0,
    simplifyLandM: values['simplify-land-m'] ? Number(values['simplify-land-m']) : 10,
    exclude: new Set((values.exclude ?? '').split(',').map((s) => s.trim()).filter(Boolean)),
    positionals,
    keep: Number(values.keep ?? 6),
    prefix: values.prefix ?? 'pack-',
    noManifest: values['no-manifest'] ?? false,
  };
}

export interface SourceReport {
  source: PackSource;
  warnings: string[];
  extra?: Record<string, unknown>;
}

export async function writeReport(reportsDir: string, name: string, report: unknown): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(reportsDir, { recursive: true });
  await writeFile(path.join(reportsDir, `${name}.json`), JSON.stringify(report, null, 2));
}

export async function readReport<T>(reportsDir: string, name: string): Promise<T | undefined> {
  const { readFile } = await import('node:fs/promises');
  try {
    return JSON.parse(await readFile(path.join(reportsDir, `${name}.json`), 'utf8')) as T;
  } catch {
    return undefined;
  }
}
