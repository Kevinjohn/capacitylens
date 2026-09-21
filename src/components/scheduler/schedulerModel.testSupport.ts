import type { Allocation, AppData, ISODate, Resource, Weekday } from "@capacitylens/shared/types/entities";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import {
  buildCapacityWindow as capacityForWindowWithWeek,
  resolveUtilization as utilizationWithWeek,
} from "../../lib/capacity";
import { buildEmptyFilters } from "../../store/useStore";
import { makeActivity, makeAllocation, makeClient, makeProject, makeResource } from "../../test/fixtures";
import { buildColumnGeometry } from "./columnGeometry";
import { buildSchedulerModel, type GroupModel } from "./schedulerModel";

interface CapacityForWindowOfTestInput {
  resource: Resource;
  allocations: Allocation[];
  timeOff: AppData["timeOff"];
  windowStart: ISODate;
  windowEnd: ISODate;
  accountWorkingDays?: Weekday[] | undefined;
  closures?: AppData["closures"] | undefined;
}

interface UtilizationOfTestInput {
  resource: Resource;
  allocations: Allocation[];
  timeOff: AppData["timeOff"];
  windowStart: ISODate;
  windowEnd: ISODate;
  accountWorkingDays?: Weekday[] | undefined;
  closures?: AppData["closures"] | undefined;
}

interface SchedulerModelTestInput {
  filters?: ReturnType<typeof buildEmptyFilters> | undefined;
  disciplinesEnabled?: boolean | undefined;
  placeholdersEnabled?: boolean | undefined;
  externalEnabled?: boolean | undefined;
}

export const DEFAULT_ACCOUNT_WORKING_DAYS: Weekday[] = [1, 2, 3, 4, 5];
export const capacityForWindowOf = ({
  resource,
  allocations,
  timeOff,
  windowStart,
  windowEnd,
  accountWorkingDays = DEFAULT_ACCOUNT_WORKING_DAYS,
  closures = [],
}: CapacityForWindowOfTestInput) =>
  capacityForWindowWithWeek({
    resource,
    allocations,
    timeOff,
    start: windowStart,
    end: windowEnd,
    effectiveWeek: effectiveWorkingWeek(resource, accountWorkingDays),
    closures,
  });
export const utilizationOf = ({
  resource,
  allocations,
  timeOff,
  windowStart,
  windowEnd,
  accountWorkingDays = DEFAULT_ACCOUNT_WORKING_DAYS,
  closures = [],
}: UtilizationOfTestInput) =>
  utilizationWithWeek({
    resource,
    allocations,
    timeOff,
    start: windowStart,
    end: windowEnd,
    effectiveWeek: effectiveWorkingWeek(resource, accountWorkingDays),
    closures,
  });

export const start = "2026-06-01";
export const end = "2026-06-07";
export const days = eachDayISO(start, end);
export const geom = buildColumnGeometry(days, 48, { minimiseWeekends: false, weekendWidth: 22 });

export function dataset(
  disciplines: AppData["disciplines"] = [
    { id: "d-design", accountId: "acct-test", createdAt: "t", updatedAt: "t", name: "Design", sortOrder: 0 },
    { id: "d-dev", accountId: "acct-test", createdAt: "t", updatedAt: "t", name: "Development", sortOrder: 1 },
  ],
): AppData {
  return {
    ...emptyAppData(),
    disciplines,
    clients: [makeClient({ accountId: "acct-test", name: "Acme", color: "#1" })],
    projects: [
      makeProject({ accountId: "acct-test", name: "P1", color: "#2" }),
      makeProject({ id: "p2", accountId: "acct-test", name: "P2", color: "#3" }),
    ],
    activities: [
      makeActivity({ accountId: "acct-test", name: "T1" }),
      makeActivity({ id: "t2", accountId: "acct-test", name: "T2", projectId: "p2" }),
    ],
    resources: [
      makeResource({
        id: "r1",
        accountId: "acct-test",
        name: "Designer Dana",
        role: "Designer",
        disciplineId: "d-design",
        color: "#4",
      }),
      makeResource({
        id: "r2",
        accountId: "acct-test",
        name: "Dev Sam",
        role: "Developer",
        disciplineId: "d-dev",
        color: "#5",
      }),
    ],
    allocations: [
      makeAllocation({ accountId: "acct-test" }),
      makeAllocation({
        id: "a2",
        accountId: "acct-test",
        activityId: "t2",
        startDate: "2026-06-03",
        endDate: "2026-06-04",
        hoursPerDay: 4,
        status: "tentative",
      }),
      makeAllocation({ id: "a3", accountId: "acct-test", resourceId: "r2", activityId: "t2" }),
    ],
    timeOff: [],
  };
}

export const build = ({
  filters = buildEmptyFilters(),
  disciplinesEnabled = true,
  placeholdersEnabled = true,
  externalEnabled = true,
}: SchedulerModelTestInput = {}) =>
  buildSchedulerModel({
    data: dataset(),
    geom,
    days,
    visibleWindow: { start, end },
    overSoonWindow: { start, end },
    filters,
    preferences: { disciplinesEnabled, placeholdersEnabled, externalEnabled },
  });
export const allBars = (model: GroupModel[]) => model.flatMap((group) => group.rows).flatMap((row) => row.bars);

export function withExternal(): AppData {
  const data = dataset();
  data.resources.push(
    makeResource({
      id: "ext1",
      accountId: "acct-test",
      kind: "external",
      name: "Kord Industries",
      role: "Partner studio",
      color: "#9ca3af",
    }),
  );
  data.allocations.push({
    id: "aext",
    accountId: "acct-test",
    createdAt: "t",
    updatedAt: "t",
    resourceId: "ext1",
    activityId: "t1",
    startDate: "2026-06-05",
    endDate: "2026-06-07",
    hoursPerDay: 0,
    status: "confirmed",
  });
  data.timeOff.push({
    id: "toext",
    accountId: "acct-test",
    createdAt: "t",
    updatedAt: "t",
    resourceId: "ext1",
    startDate: "2026-06-02",
    endDate: "2026-06-03",
    type: "holiday",
  });
  return data;
}
