import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { daysInclusive, eachDayISO } from "@capacitylens/shared/lib/dateMath";
import { effectiveWorkingWeek, lacksEffectiveWorkingDays } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { spanDays } from "@capacitylens/shared/lib/schedulingDays";
import type { ISODate, Resource } from "@capacitylens/shared/types/entities";
import { FULL_DAY_HOURS } from "@capacitylens/shared/types/entities";
import { resolveScheduledHoursOnDay } from "../../lib/capacity";

import { resolveProjectSelection, hasWorkingSpan } from "./allocationModalSelection";
import type { AllocationModalSnapshot } from "./allocationModalSnapshot";

type SeedInput = Pick<AllocationModalSnapshot, "editing" | "create" | "data" | "mode"> & {
  resourceById: Map<string, Resource>;
  accountWorkingDays: ReturnType<typeof normalizeAccountWorkingDays>;
  today: ISODate;
};

function resolveInitialLocked({
  editing,
  initialActivity,
  initialPlaceholderProjectId,
}: {
  editing: SeedInput["editing"];
  initialActivity: SeedInput["data"]["activities"][number] | undefined;
  initialPlaceholderProjectId: string | undefined;
}) {
  if (!editing) return initialPlaceholderProjectId;
  if (editing.projectId !== undefined) return editing.projectId;
  return initialActivity ? resolveProjectSelection(initialActivity) : initialPlaceholderProjectId;
}

function resolveInitialDaysOver({
  seedEnd,
  initialStart,
  initialUsesWorkingSpan,
  initialEffectiveWeek,
  initialIgnoreWeekends,
}: {
  seedEnd: ISODate | undefined;
  initialStart: ISODate;
  initialUsesWorkingSpan: boolean;
  initialEffectiveWeek: ReturnType<typeof effectiveWorkingWeek> | null;
  initialIgnoreWeekends: boolean;
}) {
  if (!seedEnd) return 1;
  if (initialUsesWorkingSpan && lacksEffectiveWorkingDays(initialEffectiveWeek, initialIgnoreWeekends)) return 1;
  if (!initialUsesWorkingSpan) return Math.max(1, daysInclusive(initialStart, seedEnd));
  const workingDays = initialEffectiveWeek?.kind === "days" ? initialEffectiveWeek.days : undefined;
  return Math.max(
    1,
    spanDays(initialStart, seedEnd, {
      ...(workingDays ? { workingDays } : {}),
      ignoreWeekends: initialIgnoreWeekends,
    }),
  );
}

function resolveDraftSeedValues({ editing, create, today }: Pick<SeedInput, "editing" | "create" | "today">) {
  if (editing) {
    return {
      initialResourceId: editing.resourceId,
      initialStart: editing.startDate,
      seedEnd: editing.endDate,
      initialIgnoreWeekends: editing.ignoreWeekends ?? false,
    };
  }
  return {
    initialResourceId: create?.resourceId ?? "",
    initialStart: create?.startDate ?? today,
    seedEnd: create?.endDate,
    initialIgnoreWeekends: false,
  };
}

function resolveSeedSelection(input: SeedInput) {
  const { editing, data, resourceById, accountWorkingDays } = input;
  const initialActivity = editing ? data.activities.find((activity) => activity.id === editing.activityId) : undefined;
  const draftValues = resolveDraftSeedValues(input);
  const { initialResourceId } = draftValues;
  const initialResource = resourceById.get(initialResourceId);
  const initialEffectiveWeek = initialResource ? effectiveWorkingWeek(initialResource, accountWorkingDays) : null;
  const initialPlaceholderProjectId = initialResource?.kind === "placeholder" ? initialResource.projectId : undefined;
  return {
    ...draftValues,
    initialActivity,
    initialResource,
    initialEffectiveWeek,
    initialPlaceholderProjectId,
  };
}

function resolveInitialCapacityHours({
  initialResource,
  initialEffectiveWeek,
  initialStart,
  seedEnd,
  initialDaysOver,
}: ReturnType<typeof resolveSeedSelection> & { initialDaysOver: number }) {
  if (!initialResource || !initialEffectiveWeek) return initialDaysOver * FULL_DAY_HOURS;
  return eachDayISO(initialStart, seedEnd ?? initialStart).reduce(
    (sum, day) => sum + resolveScheduledHoursOnDay(initialResource, day, initialEffectiveWeek),
    0,
  );
}

export function buildAllocationModalSeed({
  editing,
  create,
  data,
  mode,
  resourceById: resourcesById,
  accountWorkingDays,
  today,
}: SeedInput) {
  const selection = resolveSeedSelection({
    editing,
    create,
    data,
    mode,
    resourceById: resourcesById,
    accountWorkingDays,
    today,
  });
  const {
    initialActivity,
    initialResourceId,
    initialResource,
    initialEffectiveWeek,
    initialPlaceholderProjectId,
    initialStart,
    seedEnd,
    initialIgnoreWeekends,
  } = selection;
  const initialLocked = resolveInitialLocked({ editing, initialActivity, initialPlaceholderProjectId });
  const initialScheduledHours =
    initialResource && initialEffectiveWeek
      ? resolveScheduledHoursOnDay(initialResource, initialStart, initialEffectiveWeek)
      : FULL_DAY_HOURS;

  // Days-mode inputs (used only when isDays). For an EXISTING allocation we invert
  // hours/dates against the assignee/company effective week; for a NEW one we honour the span
  // the user drew on the lane (start..end) at full-time load, mirroring how hourly
  // create defaults hours to a full working day across the same range.
  const initialUsesWorkingSpan = hasWorkingSpan(initialResource, mode);
  const initialDaysOver = resolveInitialDaysOver({
    seedEnd,
    initialStart,
    initialUsesWorkingSpan,
    initialEffectiveWeek,
    initialIgnoreWeekends,
  });
  const initialCapacityHours = resolveInitialCapacityHours({ ...selection, initialDaysOver });
  return {
    editing,
    create,
    initialResourceId,
    initialResource,
    initialLocked,
    initialStart,
    initialScheduledHours,
    initialDaysOver,
    initialCapacityHours,
  };
}
export type AllocationModalSeed = ReturnType<typeof buildAllocationModalSeed>;
