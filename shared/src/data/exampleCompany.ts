import type { AppData, Discipline, ID, ISODate, ISOTimestamp, Weekday } from "../types/entities";
import { newId } from "../lib/id";
import { addDaysISO, startOfWeekISO } from "../lib/dateMath";

// One small company's worth of rows a new owner can add to an empty company: just enough to see a
// schedule working (two people, a client, a project, a few bookings) and small enough to read at a
// glance. Rows are ordinary rows with fresh ids; nothing marks them as sample data, so deleting them
// leaves no trace. Names follow the comic-book rule for invented people (DC universe).

export type ExampleCompanyData = Pick<
  AppData,
  "disciplines" | "resources" | "clients" | "projects" | "phases" | "activities" | "allocations" | "timeOff"
>;

export interface ExampleCompanyInput {
  accountId: ID;
  /** Any date in the week the schedule should open on, in the company's own time zone. */
  referenceDate: ISODate;
  /** The company's first weekday; the example Monday-to-Friday bookings sit inside that week. */
  weekStartsOn?: 0 | 1;
  now?: ISOTimestamp;
}

type Stamp = { accountId: ID; createdAt: ISOTimestamp; updatedAt: ISOTimestamp };
const WORKING_DAYS: Weekday[] = [1, 2, 3, 4, 5];

/** Total number of rows in a generated set, for callers that report or assert what was added. */
export function countExampleRows(data: ExampleCompanyData): number {
  return Object.values(data).reduce((total, rows) => total + rows.length, 0);
}

function buildDisciplines(stamp: Stamp) {
  return {
    design: { id: newId(), name: "Design", color: "#2d75da", sortOrder: 0, ...stamp },
    development: { id: newId(), name: "Development", color: "#3ace6b", sortOrder: 1, ...stamp },
  };
}

/** A person's colour derives from their discipline. */
function buildPerson(stamp: Stamp, discipline: Discipline, who: { name: string; role: string }) {
  return {
    id: newId(),
    kind: "person" as const,
    ...who,
    disciplineId: discipline.id,
    employmentType: "permanent" as const,
    engagement: "studio" as const,
    workingHoursPerDay: 8,
    workingDays: [...WORKING_DAYS],
    halfDays: [],
    color: discipline.color ?? "#2d75da",
    ...stamp,
  };
}

function buildWork(stamp: Stamp) {
  const client = { id: newId(), name: "Queen Consolidated", color: "#e02727", ...stamp };
  const project = { id: newId(), name: "Star City Website", clientId: client.id, color: "#da2d92", ...stamp };
  const phase = { id: newId(), name: "Discovery", projectId: project.id, ...stamp };
  const projectActivity = { projectId: project.id, kind: "project" as const, ...stamp };
  return {
    client,
    project,
    phase,
    wireframes: { id: newId(), name: "Wireframes", phaseId: phase.id, ...projectActivity },
    build: { id: newId(), name: "Build", ...projectActivity },
    admin: { id: newId(), name: "Admin", kind: "internal" as const, ...stamp },
  };
}

interface BookingSpec {
  resourceId: ID;
  activityId: ID;
  /** First and last working day of the fortnight, counting this week's Monday as 0. */
  days: [number, number];
  hoursPerDay: number;
  status: "confirmed" | "tentative";
}

/** Build the example set for one company. Pure apart from the fresh ids. */
export function buildExampleCompany({
  accountId,
  referenceDate,
  weekStartsOn = 1,
  now = new Date().toISOString(),
}: ExampleCompanyInput): ExampleCompanyData {
  const weekStart = startOfWeekISO(referenceDate, weekStartsOn);
  const monday = weekStartsOn === 0 ? addDaysISO(weekStart, 1) : weekStart;
  // Working day `n` of the fortnight, skipping the weekend between the two weeks.
  const workday = (n: number): ISODate => addDaysISO(monday, n + 2 * Math.floor(n / 5));
  const stamp = { accountId, createdAt: now, updatedAt: now };
  const booking = ({ days, ...rest }: BookingSpec) => ({
    id: newId(),
    startDate: workday(days[0]),
    endDate: workday(days[1]),
    ...rest,
    ...stamp,
  });

  const { design, development } = buildDisciplines(stamp);
  const dick = buildPerson(stamp, design, { name: "Dick Grayson", role: "Designer" });
  const barbara = buildPerson(stamp, development, { name: "Barbara Gordon", role: "Developer" });
  const work = buildWork(stamp);
  const dickBooking = (spec: Omit<BookingSpec, "resourceId">) => booking({ resourceId: dick.id, ...spec });

  return {
    disciplines: [design, development],
    resources: [dick, barbara],
    clients: [work.client],
    projects: [work.project],
    phases: [work.phase],
    activities: [work.wireframes, work.build, work.admin],
    allocations: [
      dickBooking({ activityId: work.wireframes.id, days: [0, 3], hoursPerDay: 8, status: "confirmed" }),
      dickBooking({ activityId: work.admin.id, days: [4, 4], hoursPerDay: 4, status: "confirmed" }),
      dickBooking({ activityId: work.wireframes.id, days: [5, 7], hoursPerDay: 6, status: "tentative" }),
      booking({
        resourceId: barbara.id,
        activityId: work.build.id,
        days: [1, 6],
        hoursPerDay: 6,
        status: "confirmed",
      }),
    ],
    timeOff: [
      {
        id: newId(),
        resourceId: barbara.id,
        startDate: workday(8),
        endDate: workday(9),
        type: "holiday" as const,
        ...stamp,
      },
    ],
  };
}
