import { externalCapacityDefaults } from "../types/entities";
import { NEUTRAL_COLOR } from "../lib/color";
import { buildInternalClient } from "./internalClient";
import type { AppData } from "../types/entities";
import { defaultAccountWorkingDays } from "../lib/accountWorkingDays";
import { addDaysISO, dayIndex, startOfWeekISO, todayISO } from "../lib/dateMath";
import { isValidISODate } from "../lib/integrity";

// Two demo companies, loaded on first run so the account picker isn't empty.
// "Wayne Enterprises" is the rich dataset (stacked/overlapping allocations, an
// over-allocated day, a limited-days freelancer, a project-bound placeholder, an
// external partner and a block of time off). The placeholder and external rows are seeded but
// hidden until their default-off per-account visibility settings are enabled. "Stark Industries" is a
// small second tenant — enough to prove
// switching companies swaps the whole dataset. Every scoped entity carries an
// `accountId`; the store filters on it everywhere.

const TS = "2026-05-01T00:00:00.000Z";
const SEED_WEEK = "2026-06-01";

const STUDIO = "a-studio";
const LOFT = "a-loft";

export function seed(): AppData {
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
    resources: [
      {
        id: "r-tyler",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        kind: "person",
        name: "Bruce Wayne",
        role: "Designer",
        disciplineId: "d-design",
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#2d75da",
      },
      {
        id: "r-pam",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        kind: "person",
        name: "Diana Prince",
        role: "PR & Brand",
        disciplineId: "d-copy",
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#ed841b",
      },
      {
        id: "r-nike",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        kind: "person",
        name: "Clark Kent",
        role: "Web Developer",
        disciplineId: "d-dev",
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#3ace6b",
      },
      {
        id: "r-alex",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        kind: "person",
        name: "Barry Allen",
        role: "Front End (freelance)",
        disciplineId: "d-dev",
        employmentType: "freelancer",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3],
        halfDays: [],
        color: "#2d75da",
      },
      {
        id: "r-ph-designer",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        kind: "placeholder",
        role: "Senior Designer",
        disciplineId: "d-design",
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#2d75da",
        projectId: "p-acme",
      },
      // External / 3rd-party partner studio: assignable to activities but has NO capacity/utilisation —
      // once the default-off account setting is enabled, it renders neutral in its own band at the
      // bottom of the schedule (see ResourceKind). Its working hours/days are unused silent defaults.
      {
        id: "r-ext-northstar",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        kind: "external",
        name: "Kord Industries",
        role: "Partner studio",
        ...externalCapacityDefaults(),
        color: NEUTRAL_COLOR,
      },
      {
        id: "r-jo",
        accountId: LOFT,
        createdAt: TS,
        updatedAt: TS,
        kind: "person",
        name: "Steve Rogers",
        role: "Product Designer",
        disciplineId: "d-loft-design",
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#2d75da",
      },
    ],
    clients: [
      // One built-in "Internal" pseudo-client per account (builtin: true) — owns project-less
      // internal/cross-project work and can own real projects. Protected (no rename/delete). See
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
    activities: [
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
      // Cross-project (no-project) activities — available across any project; the schedule's activity lens
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
    ],
    allocations: [
      // Bruce: two overlapping bars on 06-03/06-04 -> stacks + over-allocated (8 + 4 > 8).
      {
        id: "a-tyler-1",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        resourceId: "r-tyler",
        activityId: "t-wires",
        startDate: "2026-06-01",
        endDate: "2026-06-04",
        hoursPerDay: 8,
        status: "confirmed",
      },
      {
        id: "a-tyler-2",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        resourceId: "r-tyler",
        activityId: "t-visual",
        startDate: "2026-06-03",
        endDate: "2026-06-08",
        hoursPerDay: 4,
        status: "tentative",
      },
      {
        id: "a-nike-1",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        resourceId: "r-nike",
        activityId: "t-cms",
        startDate: "2026-06-01",
        endDate: "2026-06-05",
        hoursPerDay: 8,
        status: "confirmed",
      },
      {
        id: "a-alex-1",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        resourceId: "r-alex",
        activityId: "t-cms",
        startDate: "2026-06-01",
        endDate: "2026-06-03",
        hoursPerDay: 8,
        status: "confirmed",
      },
      {
        id: "a-ph-1",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        resourceId: "r-ph-designer",
        activityId: "t-visual",
        startDate: "2026-06-02",
        endDate: "2026-06-05",
        hoursPerDay: 8,
        status: "confirmed",
      },
      // External partner studio booked on Queen Consolidated's visual design — a span only, no hours (hoursPerDay 0).
      {
        id: "a-ext-1",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        resourceId: "r-ext-northstar",
        activityId: "t-visual",
        startDate: "2026-06-02",
        endDate: "2026-06-09",
        hoursPerDay: 0,
        status: "confirmed",
        ignoreWeekends: true,
      },
      {
        id: "a-pam-1",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        resourceId: "r-pam",
        activityId: "t-brand",
        startDate: "2026-06-01",
        endDate: "2026-06-09",
        hoursPerDay: 6,
        status: "confirmed",
      },
      // A cross-project activity ("Design") booked across a project boundary — demonstrates the
      // schedule's activity lens ("all design work", regardless of project/client).
      {
        id: "a-alex-design",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        resourceId: "r-alex",
        activityId: "t-design",
        startDate: "2026-06-08",
        endDate: "2026-06-10",
        hoursPerDay: 8,
        status: "confirmed",
      },
      {
        id: "a-jo-1",
        accountId: LOFT,
        createdAt: TS,
        updatedAt: TS,
        resourceId: "r-jo",
        activityId: "t-loft-screens",
        startDate: "2026-06-01",
        endDate: "2026-06-05",
        hoursPerDay: 8,
        status: "confirmed",
      },
    ],
    timeOff: [
      {
        id: "to-tyler",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        resourceId: "r-tyler",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        type: "holiday",
        note: "Long weekend",
      },
    ],
  };
}

/** The canonical demo scenarios shifted onto the week containing `referenceDate`.
 * Keep `seed()` fixed for repeatable tests, screenshots and written walkthroughs; runtime demo
 * entry points use this variant so a new visitor never lands on an empty, expired schedule. */
export function seedForCurrentWeek(referenceDate = todayISO()): AppData {
  const week = startOfWeekISO(referenceDate);
  const shift = (date: string) => {
    const shifted = addDaysISO(week, dayIndex(date, SEED_WEEK));
    if (!isValidISODate(shifted)) throw new RangeError("The demo week cannot extend beyond the supported date range.");
    return shifted;
  };
  const data = seed();
  return {
    ...data,
    allocations: data.allocations.map((row) => ({
      ...row,
      startDate: shift(row.startDate),
      endDate: shift(row.endDate),
    })),
    timeOff: data.timeOff.map((row) => ({
      ...row,
      startDate: shift(row.startDate),
      endDate: shift(row.endDate),
    })),
  };
}
