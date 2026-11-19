import { isDeepStrictEqual } from 'node:util';
import { activeOnly } from '@capacitylens/shared/domain/lifecycle';
import { APP_DATA_KEYS, type AppData, type AppDataKey } from '@capacitylens/shared/types/entities';
import type { PlanningMutationInput, ProjectedPlanningRow } from '#validators/planning/contracts';
import type { WrittenRow } from '#services/planning/writer';

/** Whether every written row is the same before and after, ignoring its revision timestamp. */
export function changesNothing(written: WrittenRow[]): boolean {
  return written.every(({ before, after }) => {
    if (!before || !after) return false;
    const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
    fields.delete('updatedAt');
    return [...fields].every((field) => isDeepStrictEqual(before[field], after[field]));
  });
}

/**
 * The tables an operation wrote, for the audit entry. A row hidden from the active projection both
 * before and after the write is left out, so a write to already-hidden rows names no table.
 */
export function listAuditedEntities(written: WrittenRow[], before: AppData, after: AppData) {
  const visibleBefore = activeOnly(before);
  const visibleAfter = activeOnly(after);
  const isVisible = (state: AppData, entity: AppDataKey, id: string) =>
    state[entity].some((row: { id: string }) => row.id === id);
  return [
    ...new Set(
      written
        .filter(
          ({ entity, id }) =>
            isVisible(visibleBefore, entity, id) || isVisible(visibleAfter, entity, id)
        )
        .map(({ entity }) => entity)
    ),
  ];
}

/** Planning rows compared without their timestamps, for no-change detection. */
export function buildSemanticState(data: AppData) {
  return JSON.stringify(
    APP_DATA_KEYS.map((entity) =>
      data[entity]
        .map((row) =>
          Object.fromEntries(
            Object.entries(row)
              .filter(([field]) => field !== 'updatedAt')
              .sort(([a], [b]) => a.localeCompare(b))
          )
        )
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    )
  );
}

/** Rows a mutation inserted, changed or removed between two projections. */
export function projectionChanges(before: AppData, after: AppData) {
  const upserts: ProjectedPlanningRow[] = [];
  const removed: Array<{ entity: (typeof APP_DATA_KEYS)[number]; id: string }> = [];
  for (const entity of APP_DATA_KEYS) {
    const previous = new Map(before[entity].map((row) => [row.id, row]));
    const currentIds = new Set(after[entity].map((row) => row.id));
    for (const row of after[entity]) {
      if (JSON.stringify(previous.get(row.id)) !== JSON.stringify(row)) {
        upserts.push({ entity, row } as ProjectedPlanningRow);
      }
    }
    for (const row of before[entity]) {
      if (!currentIds.has(row.id)) removed.push({ entity, id: row.id });
    }
  }
  return { upserts, removed };
}

/**
 * Fields whose change alters what a saved before-image may reveal: private names, and the activity
 * kind that decides which fields an activity carries.
 */
export const PRIVACY_TRIGGER_FIELDS: Partial<Record<AppDataKey, readonly string[]>> = {
  clients: ['isPrivate', 'codeName'],
  projects: ['isPrivate', 'codeName'],
  activities: ['kind'],
};

function triggerFields(entity: AppDataKey) {
  return PRIVACY_TRIGGER_FIELDS[entity] ?? [];
}

/** A catalogue update that actually changes a privacy trigger field ends pending restoration. */
export function invalidatesRestoration(
  intent: PlanningMutationInput['intent'],
  written: WrittenRow[]
) {
  if (intent.operation !== 'catalogue.update') return false;
  const { entity, id, changes } = intent.entity;
  const fields = triggerFields(entity);
  if (fields.length === 0) return false;
  const row = written.find((item) => item.entity === entity && item.id === id);
  return fields.some(
    (field) => Object.hasOwn(changes, field) && row?.before?.[field] !== row?.after?.[field]
  );
}
