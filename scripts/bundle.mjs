// Bundle the server into a single ESM file with no runtime dependencies, so
// `npx fpv-airspace` downloads one small tarball and starts in seconds.
import { build } from 'esbuild';
import { chmod, mkdir, readFile, rm } from 'node:fs/promises';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
  define: { __PKG_VERSION__: JSON.stringify(version) },
  banner: {
    // CommonJS dependencies (express and friends) need require/__dirname inside an ESM bundle.
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __dirname_ } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __dirname_(__filename);',
    ].join('\n'),
  },
});
await chmod('dist/index.js', 0o755);
