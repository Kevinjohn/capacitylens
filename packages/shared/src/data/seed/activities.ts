import { NULLABLE_FIELDS } from "../../types/nullableFields.js";
import type { AppData } from "../../types/entities.js";
import { SEED_TIMESTAMP, STUDIO, LOFT } from "./constants.js";

const ACTIVITIES: AppData["activities"] = [
  {
    ...NULLABLE_FIELDS.activities,
    id: "t-wires",
    accountId: STUDIO,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    name: "Wireframes",
    kind: "project",
    projectId: "p-acme",
    phaseId: "ph-disc",
  },
  {
    ...NULLABLE_FIELDS.activities,
    id: "t-visual",
    accountId: STUDIO,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    name: "Visual Design",
    kind: "project",
    projectId: "p-acme",
    phaseId: "ph-build",
  },
  {
    ...NULLABLE_FIELDS.activities,
    id: "t-cms",
    accountId: STUDIO,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    name: "CMS Review",
    kind: "project",
    projectId: "p-acme",
  },
  {
    ...NULLABLE_FIELDS.activities,
    id: "t-brand",
    accountId: STUDIO,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    name: "Brand System",
    kind: "project",
    projectId: "p-brand",
  },
  // Internal (no-project) activity, internal work, allocatable to anyone.
  {
    ...NULLABLE_FIELDS.activities,
    id: "t-admin",
    accountId: STUDIO,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    name: "Admin / Internal",
    kind: "internal",
  },
  // All-projects (no-project) activities, available across any project; the schedule's activity lens
  // groups them so you can see "all design" / "all workshops" regardless of project.
  {
    ...NULLABLE_FIELDS.activities,
    id: "t-design",
    accountId: STUDIO,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    name: "Design",
    kind: "repeatable",
  },
  {
    ...NULLABLE_FIELDS.activities,
    id: "t-workshop",
    accountId: STUDIO,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    name: "Workshop",
    kind: "repeatable",
  },
  {
    ...NULLABLE_FIELDS.activities,
    id: "t-loft-screens",
    accountId: LOFT,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    name: "App Screens",
    kind: "project",
    projectId: "p-loft-app",
  },
];

/** Fresh copies of the seed activities. */
export function createActivities(): AppData["activities"] {
  return ACTIVITIES.map((activity) => ({ ...activity }));
}
