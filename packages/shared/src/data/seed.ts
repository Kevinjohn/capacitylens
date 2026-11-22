import type { AppData } from '../types/entities.js';
import { addDaysISO, calculateDayIndex, startOfWeekISO, formatISODate } from '../lib/dateMath.js';
import { isValidISODate } from '../lib/isoDates.js';
import { SEED_WEEK } from './seed/constants.js';
import { createOrgTables } from './seed/orgTables.js';
import { createResources } from './seed/resources.js';
import { createActivities } from './seed/activities.js';
import { createAllocations } from './seed/allocations.js';
import { createSchedule } from './seed/schedule.js';

// Fictional seed data spans two companies to exercise server isolation. The disposable demo
// selects only a-studio. Its rich schedule includes overlapping allocations, a limited-days
// freelancer, a project-bound placeholder, an external partner and time off. Placeholder and
// external rows remain hidden until their default-off company visibility settings are enabled.

/** Build deterministic fictional company, people and scheduling seed data. */
export function seed(): AppData {
  const { companies, disciplines, clients, projects, phases } = createOrgTables();
  return {
    companies,
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
 * Keep `seed()` fixed for reproducible tests, screenshots and written walkthroughs; disposable server demo
 * entry points use this variant so a new visitor never lands on an empty, expired schedule. */
export function seedForCurrentWeek(referenceDate = formatISODate(new Date())): AppData {
  const week = startOfWeekISO(referenceDate);
  const shift = (date: string) => {
    const shifted = addDaysISO(week, calculateDayIndex(date, SEED_WEEK));
    if (!isValidISODate(shifted)) {
      throw new RangeError('The demo week cannot extend beyond the supported date range.');
    }
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
