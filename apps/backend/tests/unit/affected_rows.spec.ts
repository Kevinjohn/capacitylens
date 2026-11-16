import { test } from '@japa/runner';
import { affectedRows } from '#services/affected_rows';

test('a row count is read from a number or a one-number array, and nothing else', ({ assert }) => {
  assert.equal(affectedRows(3), 3);
  assert.equal(affectedRows([2]), 2);
  assert.equal(affectedRows([0]), 0);
  assert.equal(affectedRows([]), 0);
  assert.equal(affectedRows([{ id: 'a' }]), 0);
});
