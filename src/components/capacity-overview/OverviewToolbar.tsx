import { m } from "@/i18n";
import { SegmentedControl } from "../common/ui";
import { useSchedulerDensity } from "../scheduler/layout";
import type { CapacityDisplayMode } from "./capacityOverviewBar";

export interface OverviewToolbarProps {
  includeTentative: boolean;
  hasAvailability: boolean;
  showTotals: boolean;
  capacityDisplayMode: CapacityDisplayMode;
  onIncludeTentativeChange: (checked: boolean) => void;
  onHasAvailabilityChange: (checked: boolean) => void;
  onShowTotalsChange: (checked: boolean) => void;
  onCapacityDisplayModeChange: (mode: CapacityDisplayMode) => void;
}

export function OverviewToolbar(props: OverviewToolbarProps) {
  const density = useSchedulerDensity();
  return (
    <div
      data-chrome-band="toolbar"
      className="flex flex-wrap items-center gap-2 border-b border-chrome-toolbar-border bg-chrome-toolbar px-4"
      style={{ paddingBlock: density.toolbarPadY, rowGap: density.toolbarGapY }}
    >
      <h1 className="mr-auto text-xl font-semibold">{m.capacity_overview_title()}</h1>
      <SegmentedControl
        ariaLabel={m.capacity_overview_tentative_filter()}
        value={props.includeTentative ? "show" : "hide"}
        onChange={(value) => props.onIncludeTentativeChange(value === "show")}
        options={[
          { value: "show", label: m.capacity_overview_show_tentative() },
          { value: "hide", label: m.capacity_overview_hide_tentative() },
        ]}
        geometry="connected"
        size="md"
      />
      <SegmentedControl
        ariaLabel={m.capacity_overview_availability_filter()}
        value={props.hasAvailability ? "available" : "everyone"}
        onChange={(value) => props.onHasAvailabilityChange(value === "available")}
        options={[
          { value: "everyone", label: m.capacity_overview_everyone() },
          { value: "available", label: m.capacity_overview_has_availability() },
        ]}
        geometry="connected"
        size="md"
      />
      <SegmentedControl
        ariaLabel={m.capacity_overview_totals_filter()}
        value={props.showTotals ? "show" : "hide"}
        onChange={(value) => props.onShowTotalsChange(value === "show")}
        options={[
          { value: "show", label: m.capacity_overview_show_totals() },
          { value: "hide", label: m.capacity_overview_hide_totals() },
        ]}
        geometry="connected"
        size="md"
      />
      <SegmentedControl
        ariaLabel={m.capacity_overview_display_mode_filter()}
        value={props.capacityDisplayMode}
        onChange={props.onCapacityDisplayModeChange}
        options={[
          { value: "bar", label: m.capacity_overview_display_mode_bar() },
          { value: "bar-number", label: m.capacity_overview_display_mode_bar_number() },
          { value: "number", label: m.capacity_overview_display_mode_number() },
        ]}
        geometry="connected"
        size="md"
      />
    </div>
  );
}
