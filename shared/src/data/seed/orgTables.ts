import type { AppData } from "../../types/entities";
import { defaultAccountWorkingDays } from "../../lib/accountWorkingDays";
import { buildInternalClient } from "../internalClient";
import { SEED_TIMESTAMP, STUDIO, LOFT } from "./constants";

export function createOrgTables(): Pick<AppData, "accounts" | "disciplines" | "clients" | "projects" | "phases"> {
  return {
    accounts: [
      {
        id: STUDIO,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Wayne Enterprises",
        color: "#2d75da",
        workingDays: defaultAccountWorkingDays(),
      },
      {
        id: LOFT,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Stark Industries",
        color: "#2d75da",
        workingDays: defaultAccountWorkingDays(),
      },
    ],
    disciplines: [
      {
        id: "d-design",
        accountId: STUDIO,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Design",
        color: "#2d75da",
        sortOrder: 0,
      },
      {
        id: "d-dev",
        accountId: STUDIO,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Development",
        color: "#3ace6b",
        sortOrder: 1,
      },
      {
        id: "d-copy",
        accountId: STUDIO,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Copywriting",
        color: "#ed841b",
        sortOrder: 2,
      },
      {
        id: "d-loft-design",
        accountId: LOFT,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Design",
        color: "#2d75da",
        sortOrder: 0,
      },
    ],
    clients: [
      // One built-in "Internal" pseudo-client per account (builtin: true) — owns project-less
      // internal/all-projects work and can own real projects. Protected (no rename/delete). See
      // internalClient.ts; the invariant is also enforced by migrate (v5→v6) and addAccount.
      buildInternalClient(STUDIO, SEED_TIMESTAMP, "c-internal-studio"),
      buildInternalClient(LOFT, SEED_TIMESTAMP, "c-internal-loft"),
      {
        id: "c-acme",
        accountId: STUDIO,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Queen Consolidated",
        color: "#e02727",
      },
      {
        id: "c-globex",
        accountId: STUDIO,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "LexCorp",
        color: "#2d75da",
      },
      {
        id: "c-loft-northwind",
        accountId: LOFT,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Rand Corporation",
        color: "#34c7d4",
      },
    ],
    projects: [
      {
        id: "p-acme",
        accountId: STUDIO,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Project Watchtower",
        clientId: "c-acme",
        color: "#da2d92",
      },
      {
        id: "p-brand",
        accountId: STUDIO,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Metropolis Rebrand",
        clientId: "c-globex",
        color: "#34c7d4",
      },
      {
        id: "p-loft-app",
        accountId: LOFT,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Rand Mobile App",
        clientId: "c-loft-northwind",
        color: "#2d75da",
      },
    ],
    phases: [
      {
        id: "ph-disc",
        accountId: STUDIO,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Discovery",
        projectId: "p-acme",
      },
      {
        id: "ph-build",
        accountId: STUDIO,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        name: "Build",
        projectId: "p-acme",
      },
    ],
  };
}
