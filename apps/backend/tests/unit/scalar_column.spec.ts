import { test } from '@japa/runner';
import { DateTime, Settings } from 'luxon';
import { booleanColumn, timestampColumn } from '#models_support/scalar_column';

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

test.group('timestampColumn', () => {
  const column = timestampColumn('clients', 'created_at');
  const canonical = [
    '2026-07-18T00:00:00.000Z',
    '1970-01-01T00:00:00.000Z',
    '9999-12-31T23:59:59.999Z',
  ];

  test('round-trips the canonical UTC ISO string in any host zone', ({ assert }) => {
    for (const zone of ['system', 'Asia/Kolkata']) {
      Settings.defaultZone = zone;
      try {
        for (const value of canonical) {
          assert.equal(column.serialize(column.consume(value)), value, `${zone} ${value}`);
          assert.equal(column.prepare(column.consume(value)), value, `${zone} ${value}`);
        }
      } finally {
        Settings.defaultZone = 'system';
      }
    }
  });

  test('refuses a stored value that is not the canonical UTC ISO string', ({ assert }) => {
    for (const value of ['2026-07-18T00:00:00Z', 'not-a-date']) {
      assert.throws(
        () => column.consume(value),
        /Invalid persisted timestamp in clients\.created_at/
      );
    }
  });

  test('refuses to serialise an invalid date-time', ({ assert }) => {
    assert.throws(
      () => column.serialize(DateTime.invalid('test')),
      /Invalid timestamp in clients\.created_at/
    );
  });

  test('passes null through', ({ assert }) => {
    assert.isNull(column.consume(null));
    assert.isNull(column.serialize(null));
    assert.isNull(column.prepare(null));
  });
});
