import { test } from '@japa/runner';
import { readFile } from 'node:fs/promises';
import { seed } from '@capacitylens/shared/data/seed';
import { APP_DATA_KEYS } from '@capacitylens/shared/types/entities';
import { encodeRow } from '#services/state_repository';
import { tables } from '#services/product_tables';

// Captured from encodeRow before JSON columns were derived from the models; stored bytes must not move.
const expected = JSON.parse(
  await readFile(new URL('../fixtures-encoded-rows.json', import.meta.url), 'utf8')
) as unknown;

// The seed leaves most JSON columns null, so each table also encodes one row whose every empty
// column reads `true`: a JSON column stores the string "true", any other column the boolean.
const filled = (row: Record<string, unknown>) =>
  new Proxy(row, { get: (target, key: string) => target[key] ?? true });

test.group('encodeRow', () => {
  test('encodes every seed row and a fully filled row as before', ({ assert }) => {
    const data = seed();
    const actual = Object.fromEntries(
      APP_DATA_KEYS.map((key) => {
        const rows = data[key] as unknown as Record<string, unknown>[];
        return [
          tables[key],
          {
            seed: rows.map((row) => encodeRow(tables[key], row)),
            filled: encodeRow(tables[key], filled({ ...rows[0] })),
          },
        ];
      })
    );
    assert.deepEqual(actual, expected);
  });
});
