import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { useMemo, useState } from "react";
import { useActiveScopedData } from "@/store/useScopedData";
import {
  hasDisciplinesEnabled,
  hasPlaceholdersEnabled,
  hasResourceEngagementGrouping,
  resolveSchedulingMode,
  resolveTimeZone,
  resolveWeekStart,
} from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { useCalendarToday } from "../scheduler/useCalendarToday";
import { CapacityOverviewTable } from "./CapacityOverviewTable";
import { buildCapacityOverviewModel } from "./capacityOverviewModel";

export function CapacityOverviewView() {
  const [includeTentative, setIncludeTentative] = useState(true);
  const [hasAvailability, setHasAvailability] = useState(false);
  const data = useStore((state) => state.data);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const scopedData = useActiveScopedData();
  const timezone = resolveTimeZone(data, activeAccountId);
  const today = useCalendarToday(timezone);
  const schedulingMode = resolveSchedulingMode(data, activeAccountId);
  const weekStartsOn = resolveWeekStart(data, activeAccountId);
  const activeAccount = useStore((state) =>
    state.data.accounts.find((account) => account.id === state.activeAccountId),
  );
  const accountWorkingDays = useMemo(
    () => normalizeAccountWorkingDays(activeAccount?.workingDays, activeAccount?.weekStartsOn ?? 1),
    [activeAccount],
  );
  const placeholdersEnabled = hasPlaceholdersEnabled(data, activeAccountId);
  const disciplinesEnabled = hasDisciplinesEnabled(data, activeAccountId);
  const groupResourcesByEngagement = hasResourceEngagementGrouping(data, activeAccountId);
  const model = useMemo(
    () =>
      buildCapacityOverviewModel({
        data: scopedData,
        today,
        weekStartsOn,
        accountWorkingDays,
        includeTentative,
        placeholdersEnabled,
        hasAvailability,
        disciplinesEnabled,
        groupResourcesByEngagement,
        blocksMode: schedulingMode === "blocks",
      }),
    [
      accountWorkingDays,
      disciplinesEnabled,
      groupResourcesByEngagement,
      hasAvailability,
      includeTentative,
      placeholdersEnabled,
      schedulingMode,
      scopedData,
      today,
      weekStartsOn,
    ],
  );

  return (
    <CapacityOverviewTable
      model={model}
      includeTentative={includeTentative}
      hasAvailability={hasAvailability}
      onIncludeTentativeChange={setIncludeTentative}
      onHasAvailabilityChange={setHasAvailability}
    />
  );
}
