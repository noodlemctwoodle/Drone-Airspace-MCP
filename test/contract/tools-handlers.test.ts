import { describe, expect, it } from 'vitest';
import { toolDefinitions } from '../../src/tools/definitions.js';
import { TOOL_NAMES } from '../../src/tools/names.js';
import { createHandlers } from '../../src/handlers/index.js';
import { buildTestDeps } from '../helpers/build-deps.js';

describe('tool / handler contract', () => {
  const names = toolDefinitions.map((t) => t.name);
  const handlers = createHandlers(buildTestDeps().deps);

  it('every definition has a handler and vice versa', () => {
    expect(new Set(names)).toEqual(new Set(handlers.keys()));
    expect(new Set(names)).toEqual(new Set(TOOL_NAMES));
  });
  it('descriptions are tight, en-GB and every schema has format', () => {
    for (const t of toolDefinitions) {
      expect(t.description.length).toBeLessThan(700);
      expect(t.description).not.toMatch(/\b\w+ize\b/);
      expect(t.description).not.toMatch(/[—\u{1F300}-\u{1FAFF}]/u);
      expect(t.inputSchema).toHaveProperty('format');
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });
});
