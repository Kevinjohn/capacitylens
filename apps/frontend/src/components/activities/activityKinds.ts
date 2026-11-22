import type { ActivityKind } from '@capacitylens/shared/types/entities';

/** The user-facing activity-kind order shared by forms and management views. */
export const ACTIVITY_KIND_ORDER = [
  'internal',
  'allProjects',
  'project',
] as const satisfies readonly ActivityKind[];
