import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('entity type modules', () => {
  // Resolve the sources relative to this file so the test is independent of the invocation directory.
  const typesDirectory = dirname(fileURLToPath(import.meta.url));

  it.each(['entityTypes.ts', 'entityKeys.ts', 'entityHelpers.ts'])(
    '%s does not import the entities barrel, so the modules form no cycle',
    (file) => {
      const source = readFileSync(resolve(typesDirectory, file), 'utf8');
      expect(source).not.toMatch(/from '\.\/entities\.js'/);
    },
  );
});
