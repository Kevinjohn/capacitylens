import { useMemo, useState } from 'react';
import { useActiveScopedData } from '@/store/useScopedData';
import {
  hasDisciplinesEnabled,
  hasPlaceholdersEnabled,
  resolveSchedulingMode,
  resolveWeekStart,
} from '@/store/selectors';
import { useStore } from '@/store/useStore';
import { useCompanyToday } from '@/hooks/useCompanyToday';
import type { CapacityDisplayMode } from './capacityOverviewBar';
import type { CapacityOverviewHorizon } from './capacityOverviewDates';
import { CapacityOverviewTable } from './CapacityOverviewTable';
import { buildCapacityOverviewModel } from './capacityOverviewModel';

/** Coordinates horizon and tentative-allocation controls with the capacity model. */
export function CapacityOverviewView() {
  const [includeTentative, setIncludeTentative] = useState(true);
  const [hasAvailability, setHasAvailability] = useState(false);
  const [showTotals, setShowTotals] = useState(false);
  const [capacityDisplayMode, setCapacityDisplayMode] = useState<CapacityDisplayMode>('ledger');
  const [horizon, setHorizon] = useState<CapacityOverviewHorizon>('4-weeks');
  const data = useStore((state) => state.data);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const scopedData = useActiveScopedData();
  const today = useCompanyToday();
  const schedulingMode = resolveSchedulingMode(data, activeAccountId);
  const weekStartsOn = resolveWeekStart(data, activeAccountId);
  const capacity = useStore((state) => state.planning.capacity);
  const placeholdersEnabled = hasPlaceholdersEnabled(data, activeAccountId);
  const disciplinesEnabled = hasDisciplinesEnabled(data, activeAccountId);
  const model = useMemo(
    () =>
      buildCapacityOverviewModel({
        data: scopedData,
        today,
        weekStartsOn,
        horizon,
        capacity,
        includeTentative,
        placeholdersEnabled,
        hasAvailability,
        disciplinesEnabled,
        blocksMode: schedulingMode === 'blocks',
      }),
    [
      capacity,
      disciplinesEnabled,
      horizon,
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
      horizon={horizon}
      includeTentative={includeTentative}
      hasAvailability={hasAvailability}
      showTotals={showTotals}
      capacityDisplayMode={capacityDisplayMode}
      onIncludeTentativeChange={setIncludeTentative}
      onHorizonChange={setHorizon}
      onHasAvailabilityChange={setHasAvailability}
      onShowTotalsChange={setShowTotals}
      onCapacityDisplayModeChange={setCapacityDisplayMode}
      data={scopedData}
    />
  );
}
