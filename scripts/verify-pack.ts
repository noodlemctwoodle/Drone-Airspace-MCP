#!/usr/bin/env tsx
import { stat } from 'node:fs/promises';
import { parsePipelineArgs } from '../pipeline/lib/cli.js';
import { verifyPack } from '../pipeline/verify/assertions.js';

const args = parsePipelineArgs(process.argv.slice(2));
const file = args.positionals[0];
if (!file) {
  console.error('usage: verify-pack.ts <pack.sqlite> [--region national|south-west] [--strict]');
  process.exit(2);
}
(async () => {
  const sizeBytes = (await stat(file)).size;
  const result = verifyPack(file, { region: args.region.name, strict: args.strict, sizeBytes });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
