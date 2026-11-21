import { test } from '@japa/runner';
import { booleanColumn } from '#models/scalar_column';

test.group('booleanColumn', () => {
  const column = booleanColumn('clients', 'is_private');

  test('consumes 1, 0 and null', ({ assert }) => {
    assert.isTrue(column.consume(1));
    assert.isFalse(column.consume(0));
    assert.isNull(column.consume(null));
  });

  test('refuses any other stored value', ({ assert }) => {
    for (const value of ['true', 2]) {
      assert.throws(
        () => column.consume(value),
        /Invalid persisted boolean in clients\.is_private/
      );
    }
  });

  test('prepares true, false and null', ({ assert }) => {
    assert.isTrue(column.prepare(true));
    assert.isFalse(column.prepare(false));
    assert.isNull(column.prepare(null));
  });

  test('refuses to prepare a value that is not a boolean', ({ assert }) => {
    assert.throws(() => column.prepare('true'), /Invalid persisted boolean in clients\.is_private/);
  });
});
