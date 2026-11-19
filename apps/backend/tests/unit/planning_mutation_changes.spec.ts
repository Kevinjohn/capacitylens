import { test } from '@japa/runner';
import type { AppDataKey } from '@capacitylens/shared/types/entities';
import { changesNothing, invalidatesRestoration } from '#services/planning/mutation_changes';
import type { WrittenRow } from '#services/planning/writer';
import type { PlanningMutationInput } from '#validators/planning/contracts';

const update = (entity: string, changes: Record<string, unknown>) =>
  ({
    operation: 'catalogue.update',
    entity: { entity, id: 'row-1', changes },
  }) as unknown as PlanningMutationInput['intent'];

const write = (
  entity: AppDataKey,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): WrittenRow[] => [
  {
    entity,
    id: 'row-1',
    before: before && { id: 'row-1', ...before },
    after: after && { id: 'row-1', ...after },
  },
];

test.group('planning privacy trigger fields', () => {
  test('restoration ends only when a trigger field actually changes', ({ assert }) => {
    const intent = update('activities', { kind: 'internal' });
    assert.isTrue(
      invalidatesRestoration(intent, write('activities', { kind: 'project' }, { kind: 'internal' }))
    );
    assert.isFalse(
      invalidatesRestoration(
        intent,
        write('activities', { kind: 'internal' }, { kind: 'internal' })
      )
    );
    assert.isFalse(
      invalidatesRestoration(
        update('clients', { name: 'Wayne' }),
        write('clients', { name: 'Gotham' }, { name: 'Wayne' })
      )
    );
  });
});

test.group('planning no-change detection', () => {
  const stored = { name: 'Gotham', workingDays: [1, 2], updatedAt: '2026-01-01T00:00:00.000Z' };

  test('rows written with the same values change nothing', ({ assert }) => {
    assert.isTrue(changesNothing(write('clients', stored, { ...stored, workingDays: [1, 2] })));
    assert.isTrue(changesNothing([]));
  });

  test('a row whose only difference is its revision timestamp changes nothing', ({ assert }) => {
    assert.isTrue(
      changesNothing(write('clients', stored, { ...stored, updatedAt: '2026-01-02T00:00:00.000Z' }))
    );
  });

  test('a changed field, an insert or a delete is a change', ({ assert }) => {
    assert.isFalse(changesNothing(write('clients', stored, { ...stored, name: 'Metropolis' })));
    assert.isFalse(changesNothing(write('clients', stored, { ...stored, workingDays: [1] })));
    assert.isFalse(changesNothing(write('clients', null, stored)));
    assert.isFalse(changesNothing(write('clients', stored, null)));
  });
});
