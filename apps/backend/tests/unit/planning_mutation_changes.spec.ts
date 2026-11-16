import { test } from '@japa/runner';
import type { AppData } from '@capacitylens/shared/types/entities';
import { invalidatesRestoration, requiresRefetch } from '#services/planning/mutation_changes';
import type { PlanningMutationInput } from '#validators/planning/contracts';

const update = (entity: string, changes: Record<string, unknown>) =>
  ({
    operation: 'catalogue.update',
    entity: { entity, id: 'row-1', changes },
  }) as unknown as PlanningMutationInput['intent'];

const state = (entity: string, row: Record<string, unknown>) =>
  ({
    clients: [],
    projects: [],
    activities: [],
    resources: [],
    [entity]: [{ id: 'row-1', ...row }],
  }) as unknown as AppData;

test.group('planning privacy trigger fields', () => {
  test('private names and activity kind trigger a refetch; other fields patch', ({ assert }) => {
    for (const [entity, field] of [
      ['clients', 'isPrivate'],
      ['clients', 'codeName'],
      ['projects', 'isPrivate'],
      ['projects', 'codeName'],
      ['activities', 'kind'],
    ]) {
      assert.isTrue(requiresRefetch(update(entity, { [field]: null })), `${entity}.${field}`);
    }
    for (const [entity, field] of [
      ['clients', 'name'],
      ['activities', 'name'],
      ['resources', 'name'],
    ]) {
      assert.isFalse(requiresRefetch(update(entity, { [field]: 'Gotham' })), `${entity}.${field}`);
    }
  });

  test('restoration ends only when a trigger field actually changes', ({ assert }) => {
    const intent = update('activities', { kind: 'internal' });
    assert.isTrue(
      invalidatesRestoration(
        intent,
        state('activities', { kind: 'project' }),
        state('activities', { kind: 'internal' })
      )
    );
    assert.isFalse(
      invalidatesRestoration(
        intent,
        state('activities', { kind: 'internal' }),
        state('activities', { kind: 'internal' })
      )
    );
    assert.isFalse(
      invalidatesRestoration(
        update('clients', { name: 'Wayne' }),
        state('clients', { name: 'Gotham' }),
        state('clients', { name: 'Wayne' })
      )
    );
  });
});
