import type { AppData } from '@capacitylens/shared/types/entities';
import type { PlanningIntent, PlanningMutationSuccess } from '#validators/planning/contracts';

type Restoration = PlanningMutationSuccess['restoration'];

/** The earlier values of exactly the fields an update supplied; an absent value restores as null. */
function buildEarlierValues(row: object | undefined, changes: object) {
  if (!row) return null;
  return Object.fromEntries(
    Object.keys(changes).map((field) => [field, (Reflect.get(row, field) as unknown) ?? null])
  );
}

function restore(restoration: Restoration): PlanningIntent | null {
  return restoration.replacementGroupId
    ? { operation: 'planning.restoreGroup', restorationGroupId: restoration.replacementGroupId }
    : null;
}

/**
 * The intent that reverses a committed one, built from the state it replaced. Null means the change
 * cannot be undone. A restore has no inverse here: only its caller knows the delete it reversed.
 */
export function buildInverseIntent(
  intent: PlanningIntent,
  before: AppData,
  companyId: string,
  restoration: Restoration
): PlanningIntent | null {
  switch (intent.operation) {
    case 'allocation.create':
      return { operation: 'allocation.delete', id: intent.allocation.id };
    case 'allocation.createGroup':
      return {
        operation: 'allocation.deleteGroup',
        ids: [intent.allocation.id, ...intent.occurrenceIds],
      };
    case 'allocation.duplicate':
      return { operation: 'allocation.delete', id: intent.occurrence.id };
    case 'allocation.update': {
      const changes = buildEarlierValues(
        before.allocations.find((row) => row.id === intent.id),
        intent.changes
      );
      return (
        changes && ({ operation: 'allocation.update', id: intent.id, changes } as PlanningIntent)
      );
    }
    case 'catalogue.create': {
      const { entity, id } = intent.entity;
      return entity === 'phases' || entity === 'disciplines'
        ? { operation: 'catalogue.delete', entity: { entity, id } }
        : { operation: 'catalogue.archive', entity: { entity, id } };
    }
    case 'catalogue.update': {
      const { entity, id } = intent.entity;
      const changes = buildEarlierValues(
        before[entity].find((row) => row.id === id),
        intent.entity.changes
      );
      return (
        changes &&
        ({ operation: 'catalogue.update', entity: { entity, id, changes } } as PlanningIntent)
      );
    }
    case 'catalogue.archive':
      return {
        operation: 'catalogue.unarchive',
        entity: { entity: intent.entity.entity, id: intent.entity.id },
      };
    case 'catalogue.unarchive':
      return {
        operation: 'catalogue.archive',
        entity: { entity: intent.entity.entity, id: intent.entity.id },
      };
    case 'resource.create':
      return { operation: 'resource.archive', id: intent.id };
    case 'resource.update': {
      const changes = buildEarlierValues(
        before.resources.find((row) => row.id === intent.id),
        intent.changes
      );
      return (
        changes && ({ operation: 'resource.update', id: intent.id, changes } as PlanningIntent)
      );
    }
    case 'resource.archive':
      return { operation: 'resource.unarchive', id: intent.id };
    case 'resource.unarchive':
      return { operation: 'resource.archive', id: intent.id };
    case 'timeOff.create':
      return { operation: 'timeOff.delete', id: intent.timeOff.id };
    case 'timeOff.repeat':
      return {
        operation: 'timeOff.deleteGroup',
        ids: [intent.timeOff.id, ...intent.occurrenceIds],
      };
    case 'timeOff.update': {
      const changes = buildEarlierValues(
        before.timeOff.find((row) => row.id === intent.id),
        intent.changes
      );
      return changes && ({ operation: 'timeOff.update', id: intent.id, changes } as PlanningIntent);
    }
    case 'closure.create':
      return { operation: 'closure.delete', id: intent.id };
    case 'closure.update': {
      const changes = buildEarlierValues(
        before.closures.find((row) => row.id === intent.id),
        intent.changes
      );
      return changes && ({ operation: 'closure.update', id: intent.id, changes } as PlanningIntent);
    }
    case 'settings.update': {
      const changes = buildEarlierValues(
        before.accounts.find((row) => row.id === companyId),
        intent.changes
      );
      return changes && ({ operation: 'settings.update', changes } as PlanningIntent);
    }
    case 'catalogue.delete':
    case 'timeOff.delete':
    case 'timeOff.deleteGroup':
    case 'closure.delete':
    case 'allocation.delete':
    case 'allocation.deleteGroup':
      return restore(restoration);
    case 'planning.restoreGroup':
      return null;
  }
}
