import type { AppData } from "../types/entities";
import { addDaysISO, dayIndex, startOfWeekISO, todayISO } from "../lib/dateMath";
import { isValidISODate } from "../lib/integrity";
import { SEED_WEEK } from "./seed/constants";
import { createOrgTables } from "./seed/orgTables";
import { createResources } from "./seed/resources";
import { createActivities } from "./seed/activities";
import { createAllocations } from "./seed/allocations";
import { createSchedule } from "./seed/schedule";

// Two demo companies, loaded on first run so the account picker isn't empty.
// "Wayne Enterprises" is the rich dataset (stacked/overlapping allocations, an
// over-allocated day, a limited-days freelancer, a project-bound placeholder, an
// external partner and a block of time off). The placeholder and external rows are seeded but
// hidden until their default-off per-account visibility settings are enabled. "Stark Industries" is a
// small second tenant — enough to prove
// switching companies swaps the whole dataset. Every scoped entity carries an
// `accountId`; the store filters on it everywhere.

export function seed(): AppData {
  const { accounts, disciplines, clients, projects, phases } = createOrgTables();
  return {
    accounts,
    disciplines,
    resources: createResources(),
    clients,
    projects,
    phases,
    activities: createActivities(),
    allocations: createAllocations(),
    ...createSchedule(),
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
    closures: data.closures.map((row) => ({
      ...row,
      startDate: shift(row.startDate),
      endDate: shift(row.endDate),
    })),
  };
}
