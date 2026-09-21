import type { AppData } from "@capacitylens/shared/types/entities";
import { useRef } from "react";
import type { RefObject } from "react";
import { m } from "@/i18n";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { PersonScheduleSheet } from "../person-schedule/PersonScheduleSheet";
import { usePersonScheduleDrawer } from "../person-schedule/usePersonScheduleDrawer";
import type { CapacityOverviewHorizon } from "./capacityOverviewDates";
import type { CapacityDisplayMode } from "./capacityOverviewBar";
import { CapacityTable } from "./CapacityOverviewTableGrid";
import { OverviewLegend } from "./OverviewLegend";
import { OverviewToolbar } from "./OverviewToolbar";
import type { PersonScheduleTriggerHandlers } from "./CapacityOverviewTableGrid";
import type { CapacityOverviewModel } from "./capacityOverviewModel";

export interface CapacityOverviewTableProps {
  model: CapacityOverviewModel;
  horizon: CapacityOverviewHorizon;
  includeTentative: boolean;
  hasAvailability: boolean;
  showTotals: boolean;
  capacityDisplayMode: CapacityDisplayMode;
  onHorizonChange: (horizon: CapacityOverviewHorizon) => void;
  onIncludeTentativeChange: (checked: boolean) => void;
  onHasAvailabilityChange: (checked: boolean) => void;
  onShowTotalsChange: (checked: boolean) => void;
  onCapacityDisplayModeChange: (mode: CapacityDisplayMode) => void;
}

interface CapacityOverviewTableWithScheduleProps extends CapacityOverviewTableProps {
  /** Scoped account data used to resolve person schedule titles. */
  data: AppData;
  /** Restores focus to a stable element when the drawer's opener has been removed from the DOM. */
  fallbackRef?: RefObject<HTMLDivElement | null>;
}

export function CapacityOverviewTable(props: CapacityOverviewTableWithScheduleProps) {
  const internalFallbackRef = useRef<HTMLDivElement>(null);
  const fallbackRef = props.fallbackRef ?? internalFallbackRef;
  const personScheduleDrawer = usePersonScheduleDrawer({ data: props.data, fallbackRef });
  const triggerHandlers: PersonScheduleTriggerHandlers = {
    personScheduleTitlesByResourceId: personScheduleDrawer.titlesByResourceId,
    onViewSchedule: personScheduleDrawer.viewSchedule,
  };
  return (
    <div ref={fallbackRef} tabIndex={-1} className="flex h-full min-h-0 flex-col">
      <OverviewToolbar
        horizon={props.horizon}
        includeTentative={props.includeTentative}
        hasAvailability={props.hasAvailability}
        showTotals={props.showTotals}
        capacityDisplayMode={props.capacityDisplayMode}
        onHorizonChange={props.onHorizonChange}
        onIncludeTentativeChange={props.onIncludeTentativeChange}
        onHasAvailabilityChange={props.onHasAvailabilityChange}
        onShowTotalsChange={props.onShowTotalsChange}
        onCapacityDisplayModeChange={props.onCapacityDisplayModeChange}
      />
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-[26px] pt-[22px] pb-[60px]">
        {!props.model.measured ? (
          <Alert>
            <AlertTitle>
              <h2>{m.capacity_overview_blocks_heading()}</h2>
            </AlertTitle>
            <AlertDescription>{m.capacity_overview_blocks_body()}</AlertDescription>
          </Alert>
        ) : (
          <section className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_1px_2px_rgba(20,22,26,0.05),0_8px_24px_-16px_rgba(20,22,26,0.18)]">
            <CapacityTable
              model={props.model}
              showTotals={props.showTotals}
              capacityDisplayMode={props.capacityDisplayMode}
              {...triggerHandlers}
            />
            <OverviewLegend />
          </section>
        )}
      </div>
      <PersonScheduleSheet
        open={personScheduleDrawer.open}
        schedule={personScheduleDrawer.schedule}
        onOpenChange={personScheduleDrawer.setOpen}
        onRestoreFocus={personScheduleDrawer.restoreFocus}
      />
    </div>
  );
}
