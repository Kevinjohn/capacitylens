import { m } from "@/i18n";
import { SegmentedControl, TogglePill } from "../common/ui";
import type { CapacityDisplayMode } from "./capacityOverviewBar";
import { horizonWeekCount } from "./capacityOverviewDates";
import type { CapacityOverviewHorizon } from "./capacityOverviewDates";
import { TentativeSwatch } from "./OverviewLegend";

export interface OverviewToolbarProps {
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

export function OverviewToolbar(props: OverviewToolbarProps) {
  return (
    <div
      data-testid="capacity-overview-toolbar"
      className="flex flex-wrap items-center gap-x-[18px] gap-y-2 border-b border-line bg-canvas px-[26px] py-3.5"
    >
      <div className="min-w-0">
        <h1 className="text-[19px] font-semibold tracking-[-0.02em]">{m.capacity_overview_title()}</h1>
        <p className="mt-0.5 text-xs text-faint">
          {m.capacity_overview_subtitle({ weeks: String(horizonWeekCount(props.horizon)) })}
        </p>
      </div>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        <SegmentedControl
          variant="recessed"
          ariaLabel={m.capacity_overview_display_mode_filter()}
          value={props.capacityDisplayMode}
          onChange={props.onCapacityDisplayModeChange}
          options={[
            { value: "ledger", label: m.capacity_overview_display_mode_ledger() },
            { value: "load-curve", label: m.capacity_overview_display_mode_load_curve() },
          ]}
        />
        <SegmentedControl
          variant="recessed"
          ariaLabel={m.capacity_overview_horizon_filter()}
          value={props.horizon}
          onChange={props.onHorizonChange}
          options={[
            { value: "4-weeks", label: m.capacity_overview_horizon_four_weeks() },
            { value: "8-weeks", label: m.capacity_overview_horizon_eight_weeks() },
            { value: "12-weeks", label: m.capacity_overview_horizon_twelve_weeks() },
          ]}
        />
        <TogglePill
          pressed={props.includeTentative}
          onPressedChange={props.onIncludeTentativeChange}
          swatch={<TentativeSwatch size={9} />}
        >
          {m.capacity_overview_tentative()}
        </TogglePill>
        <TogglePill pressed={props.hasAvailability} onPressedChange={props.onHasAvailabilityChange}>
          {m.capacity_overview_has_availability()}
        </TogglePill>
        <TogglePill pressed={props.showTotals} onPressedChange={props.onShowTotalsChange}>
          {m.capacity_overview_totals()}
        </TogglePill>
      </div>
    </div>
  );
}
