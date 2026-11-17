import { APP_DATA_KEYS, type AppData, type AppDataKey } from '@capacitylens/shared/types/entities';
import type { PlanningMutationInput, ProjectedPlanningRow } from '#validators/planning/contracts';

/** Planning rows compared without their timestamps, for no-change detection. */
export function semanticState(data: AppData) {
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
  before: AppData,
  after: AppData
) {
  if (intent.operation !== 'catalogue.update') return false;
  const { entity, id, changes } = intent.entity;
  const fields = triggerFields(entity);
  if (fields.length === 0) return false;
  const oldRow = before[entity].find((row) => row.id === id);
  const newRow = after[entity].find((row) => row.id === id);
  return fields.some(
    (field) =>
      Object.hasOwn(changes, field) &&
      oldRow?.[field as keyof typeof oldRow] !== newRow?.[field as keyof typeof newRow]
  );
}
