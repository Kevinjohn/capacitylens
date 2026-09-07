import type { AppData } from "../../types/entities";
import { SEED_TIMESTAMP, STUDIO, LOFT } from "./constants";

export function createActivities(): AppData["activities"] {
  return [
    {
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
      id: "t-cms",
      accountId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: "CMS Review",
      kind: "project",
      projectId: "p-acme",
    },
    {
      id: "t-brand",
      accountId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: "Brand System",
      kind: "project",
      projectId: "p-brand",
    },
    // Internal (no-project) activity — internal work, allocatable to anyone.
    {
      id: "t-admin",
      accountId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: "Admin / Internal",
      kind: "internal",
    },
    // All-projects (no-project) activities — available across any project; the schedule's activity lens
    // groups them so you can see "all design" / "all workshops" regardless of project.
    {
      id: "t-design",
      accountId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: "Design",
      kind: "repeatable",
    },
    {
      id: "t-workshop",
      accountId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: "Workshop",
      kind: "repeatable",
    },
    {
      id: "t-loft-screens",
      accountId: LOFT,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: "App Screens",
      kind: "project",
      projectId: "p-loft-app",
    },
  ];
}
