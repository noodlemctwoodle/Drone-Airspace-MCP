import { createRequire } from 'node:module';

declare const __PKG_VERSION__: string | undefined;

function readVersion(): string {
  if (typeof __PKG_VERSION__ === 'string') return __PKG_VERSION__;
  try {
    const require = createRequire(import.meta.url);
    return (require('../package.json') as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

export const NAME = 'fpv-airspace';
export const VERSION: string = readVersion();
export const REPO_URL = 'https://github.com/noodlemctwoodle/fpv-airspace';
export const USER_AGENT = `${NAME}/${VERSION} (+${REPO_URL})`;
