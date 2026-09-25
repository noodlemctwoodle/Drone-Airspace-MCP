#!/usr/bin/env node
// node:sqlite still carries an ExperimentalWarning on Node 22/24. Keep stderr
// useful by dropping that one warning and re-printing every other kind.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && /sqlite/i.test(warning.message)) return;
  console.error(`${warning.name}: ${warning.message}`);
});

import { bootstrap } from './bootstrap.js';

bootstrap(process.argv.slice(2)).catch((error) => {
  console.error(`[uk-drone-airspace-mcp] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
