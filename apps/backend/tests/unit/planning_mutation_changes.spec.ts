import { test } from '@japa/runner';
import { changesNothing, isRestorationInvalidated } from '#services/planning/mutation_changes';
import { catalogueUpdate, writtenRows } from '#tests/helpers/unit/planning_operations';

test.group('planning privacy trigger fields', () => {
  test('restoration ends only when a trigger field actually changes', ({ assert }) => {
    const intent = catalogueUpdate('activities', { kind: 'internal' });
    assert.isTrue(
      isRestorationInvalidated(
        intent,
        writtenRows('activities', { kind: 'project' }, { kind: 'internal' })
      )
    );
    assert.isFalse(
      isRestorationInvalidated(
        intent,
        writtenRows('activities', { kind: 'internal' }, { kind: 'internal' })
      )
    );
    assert.isFalse(
      isRestorationInvalidated(
        catalogueUpdate('clients', { name: 'Wayne' }),
        writtenRows('clients', { name: 'Gotham' }, { name: 'Wayne' })
      )
    );
  });
});

test.group('planning no-change detection', () => {
  const stored = { name: 'Gotham', workingDays: [1, 2], updatedAt: '2026-01-01T00:00:00.000Z' };

  test('rows written with the same values change nothing', ({ assert }) => {
    assert.isTrue(
      changesNothing(writtenRows('clients', stored, { ...stored, workingDays: [1, 2] }))
    );
    assert.isTrue(changesNothing([]));
  });

  test('a row whose only difference is its revision timestamp changes nothing', ({ assert }) => {
    assert.isTrue(
      changesNothing(
        writtenRows('clients', stored, { ...stored, updatedAt: '2026-01-02T00:00:00.000Z' })
      )
    );
  });

  test('a changed field, an insert or a delete is a change', ({ assert }) => {
    assert.isFalse(
      changesNothing(writtenRows('clients', stored, { ...stored, name: 'Metropolis' }))
    );
    assert.isFalse(changesNothing(writtenRows('clients', stored, { ...stored, workingDays: [1] })));
    assert.isFalse(changesNothing(writtenRows('clients', null, stored)));
    assert.isFalse(changesNothing(writtenRows('clients', stored, null)));
  });
});
