import { test } from '@japa/runner';
import { parseAffectedRows } from '#services/affected_rows';

test('a row count is read from a number or a one-number array, and nothing else', ({ assert }) => {
  assert.equal(parseAffectedRows(3), 3);
  assert.equal(parseAffectedRows([2]), 2);
  assert.equal(parseAffectedRows([0]), 0);
  assert.equal(parseAffectedRows([]), 0);
  assert.equal(parseAffectedRows([{ id: 'a' }]), 0);
});
