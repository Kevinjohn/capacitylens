import type { AppData } from "../../types/entities";
import { defaultAccountWorkingDays } from "../../lib/accountWorkingDays";
import { buildInternalClient } from "../internalClient";
import { TS, STUDIO, LOFT } from "./constants";

export function createOrgTables(): Pick<AppData, "accounts" | "disciplines" | "clients" | "projects" | "phases"> {
  return {
    accounts: [
      {
        id: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        name: "Wayne Enterprises",
        color: "#2d75da",
        workingDays: defaultAccountWorkingDays(),
      },
      {
        id: LOFT,
        createdAt: TS,
        updatedAt: TS,
        name: "Stark Industries",
        color: "#2d75da",
        workingDays: defaultAccountWorkingDays(),
      },
    ],
    disciplines: [
      {
        id: "d-design",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        name: "Design",
        color: "#2d75da",
        sortOrder: 0,
      },
      {
        id: "d-dev",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        name: "Development",
        color: "#3ace6b",
        sortOrder: 1,
      },
      {
        id: "d-copy",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        name: "Copywriting",
        color: "#ed841b",
        sortOrder: 2,
      },
      {
        id: "d-loft-design",
        accountId: LOFT,
        createdAt: TS,
        updatedAt: TS,
        name: "Design",
        color: "#2d75da",
        sortOrder: 0,
      },
    ],
    clients: [
      // One built-in "Internal" pseudo-client per account (builtin: true) — owns project-less
      // internal/all-projects work and can own real projects. Protected (no rename/delete). See
      // internalClient.ts; the invariant is also enforced by migrate (v5→v6) and addAccount.
      buildInternalClient(STUDIO, TS, "c-internal-studio"),
      buildInternalClient(LOFT, TS, "c-internal-loft"),
      {
        id: "c-acme",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        name: "Queen Consolidated",
        color: "#e02727",
      },
      {
        id: "c-globex",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        name: "LexCorp",
        color: "#2d75da",
      },
      {
        id: "c-loft-northwind",
        accountId: LOFT,
        createdAt: TS,
        updatedAt: TS,
        name: "Rand Corporation",
        color: "#34c7d4",
      },
    ],
    projects: [
      {
        id: "p-acme",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        name: "Project Watchtower",
        clientId: "c-acme",
        color: "#da2d92",
      },
      {
        id: "p-brand",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        name: "Metropolis Rebrand",
        clientId: "c-globex",
        color: "#34c7d4",
      },
      {
        id: "p-loft-app",
        accountId: LOFT,
        createdAt: TS,
        updatedAt: TS,
        name: "Rand Mobile App",
        clientId: "c-loft-northwind",
        color: "#2d75da",
      },
    ],
    phases: [
      {
        id: "ph-disc",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        name: "Discovery",
        projectId: "p-acme",
      },
      {
        id: "ph-build",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        name: "Build",
        projectId: "p-acme",
      },
    ],
  };
}
