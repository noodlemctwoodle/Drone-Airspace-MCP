import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string };

export const NAME: string = pkg.name;
export const VERSION: string = pkg.version;
export const REPO_URL = 'https://github.com/noodlemctwoodle/Drone-Airspace-MCP';
export const USER_AGENT = `${NAME}/${VERSION} (+${REPO_URL})`;
