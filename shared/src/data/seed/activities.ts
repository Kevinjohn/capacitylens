import type { AppData } from "../../types/entities";
import { TS, STUDIO, LOFT } from "./constants";

export function createActivities(): AppData["activities"] {
  return [
    {
      id: "t-wires",
      accountId: STUDIO,
      createdAt: TS,
      updatedAt: TS,
      name: "Wireframes",
      kind: "project",
      projectId: "p-acme",
      phaseId: "ph-disc",
    },
    {
      id: "t-visual",
      accountId: STUDIO,
      createdAt: TS,
      updatedAt: TS,
      name: "Visual Design",
      kind: "project",
      projectId: "p-acme",
      phaseId: "ph-build",
    },
    {
      id: "t-cms",
      accountId: STUDIO,
      createdAt: TS,
      updatedAt: TS,
      name: "CMS Review",
      kind: "project",
      projectId: "p-acme",
    },
    {
      id: "t-brand",
      accountId: STUDIO,
      createdAt: TS,
      updatedAt: TS,
      name: "Brand System",
      kind: "project",
      projectId: "p-brand",
    },
    // Internal (no-project) activity — internal work, allocatable to anyone.
    {
      id: "t-admin",
      accountId: STUDIO,
      createdAt: TS,
      updatedAt: TS,
      name: "Admin / Internal",
      kind: "internal",
    },
    // All-projects (no-project) activities — available across any project; the schedule's activity lens
    // groups them so you can see "all design" / "all workshops" regardless of project.
    {
      id: "t-design",
      accountId: STUDIO,
      createdAt: TS,
      updatedAt: TS,
      name: "Design",
      kind: "repeatable",
    },
    {
      id: "t-workshop",
      accountId: STUDIO,
      createdAt: TS,
      updatedAt: TS,
      name: "Workshop",
      kind: "repeatable",
    },
    {
      id: "t-loft-screens",
      accountId: LOFT,
      createdAt: TS,
      updatedAt: TS,
      name: "App Screens",
      kind: "project",
      projectId: "p-loft-app",
    },
  ];
}
