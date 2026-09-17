import { m } from "@/i18n";
import {
  computeCapacityCellFill,
  describePeriod,
  describeTotals,
  formatDayFigure,
  formatDays,
  TENTATIVE_HATCH,
  TONE_FILL,
} from "./capacityOverviewBar";
import type { CapacityDisplayMode, CapacityPeriodTotals, CapacityTotalsTone } from "./capacityOverviewBar";
import { HOURS_PER_DISPLAY_DAY } from "./capacityOverviewModel";
import type { CapacityOverviewPeriodResult } from "./capacityOverviewTypes";

const WEEK_CELL_CLASS = "border-b border-l border-line-soft p-0 align-middle";
const MONO_VALUE_CLASS = "font-mono text-[12.5px] font-medium tabular-nums";
const MONO_DETAIL_CLASS = "font-mono text-[10.5px] tabular-nums whitespace-nowrap";
// The per-device Compact view preference tightens every row, as it does on the schedule.
const COMPACT_ROW_CLASS = "[[data-compact]_&]:py-1";

const TOTALS_TONE_CLASS: Record<CapacityTotalsTone, string> = {
  danger: "text-danger",
  ink: "text-ink",
  muted: "text-muted-foreground",
};

function UnassignedValue({ result }: { result: CapacityOverviewPeriodResult }) {
  return (
    <div className={`px-3.5 py-[9px] ${COMPACT_ROW_CLASS}`}>
      {result.unassignedDemandDays > 0 ? (
        <span className={MONO_VALUE_CLASS}>{formatDays(result.unassignedDemandDays, "unassigned")}</span>
      ) : (
        <span className={`${MONO_VALUE_CLASS} text-faint`}>—</span>
      )}
    </div>
  );
}

function resolveLedgerValueInk(result: CapacityOverviewPeriodResult): string {
  if (result.freeDays > 0) return "text-ink";
  return result.overDays > 0 ? "text-danger" : "text-faint";
}

/** The free and tentative fills laid along one axis: full when nothing is booked, empty when nothing is free. */
function CapacityTrack({
  result,
  axis,
  className,
  testId,
}: {
  result: CapacityOverviewPeriodResult;
  axis: "width" | "height";
  className: string;
  testId: string;
}) {
  const fill = computeCapacityCellFill(result);
  const free = (
    <div
      data-testid="capacity-bar-free"
      data-tone={fill.tone}
      style={{ [axis]: `${fill.freeFraction * 100}%`, background: TONE_FILL[fill.tone] }}
    />
  );
  const tentative = (
    <div
      data-testid="capacity-bar-tentative"
      style={{ [axis]: `${fill.tentativeFraction * 100}%`, background: TENTATIVE_HATCH }}
    />
  );
  return (
    <div data-testid={testId} className={`flex overflow-hidden bg-line-soft ${className}`}>
      {axis === "width" ? free : tentative}
      {axis === "width" ? tentative : free}
    </div>
  );
}

function LedgerValue({ result, label }: { result: CapacityOverviewPeriodResult; label: string }) {
  const over = result.overDays > 0;
  // An overbooked week swaps the capacity figure for the overbooked days in red (the long
  // "overbooked" label wrapped inside twelve-week cells); the track itself only ever shows free time.
  return (
    <div className={`flex flex-col gap-[5px] px-3.5 py-[9px] ${COMPACT_ROW_CLASS}`}>
      <div className="flex items-baseline justify-between gap-1.5">
        <span className={`${MONO_VALUE_CLASS} ${resolveLedgerValueInk(result)}`}>
          {result.freeDays > 0 ? formatDays(result.freeDays, "capacity") : "—"}
        </span>
        {over ? (
          <span className={`${MONO_DETAIL_CLASS} text-danger`}>
            {m.capacity_overview_over_short({ days: formatDayFigure(result.overDays) })}
          </span>
        ) : (
          <span className={`${MONO_DETAIL_CLASS} text-faint`}>
            {m.capacity_overview_capacity_days({
              days: formatDayFigure(result.availableHours / HOURS_PER_DISPLAY_DAY),
            })}
          </span>
        )}
      </div>
      <CapacityTrack result={result} axis="width" testId="capacity-ledger-bar" className="h-[5px] rounded-full" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

function LoadCurveValue({ result, label }: { result: CapacityOverviewPeriodResult; label: string }) {
  return (
    <div className={`px-3.5 py-2.5 ${COMPACT_ROW_CLASS}`}>
      <CapacityTrack
        result={result}
        axis="height"
        testId="capacity-load-curve"
        className="h-[34px] flex-col justify-end rounded-[5px] [[data-compact]_&]:h-5"
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function PeriodCell({
  result,
  capacityDisplayMode,
  rangeLabel,
}: {
  result: CapacityOverviewPeriodResult;
  capacityDisplayMode: CapacityDisplayMode;
  rangeLabel: string;
}) {
  if (result.state === "unassigned") {
    return (
      <td className={WEEK_CELL_CLASS}>
        <UnassignedValue result={result} />
      </td>
    );
  }
  const label = describePeriod(result, rangeLabel);
  return (
    <td className={WEEK_CELL_CLASS} title={label}>
      {capacityDisplayMode === "ledger" ? (
        <LedgerValue result={result} label={label} />
      ) : (
        <LoadCurveValue result={result} label={label} />
      )}
    </td>
  );
}

/** The optional second header tier: committed share, free days and a committed/tentative bar. */
export function TotalsCell({ totals, rangeLabel }: { totals: CapacityPeriodTotals; rangeLabel: string }) {
  return (
    <td
      data-testid="capacity-overview-totals-cell"
      className="border-b border-l border-line border-l-line-soft px-3.5 pb-[11px] pt-0 align-bottom font-normal"
      title={describeTotals(totals, rangeLabel)}
    >
      <div className="flex items-baseline justify-between gap-1.5">
        <span className={`${MONO_VALUE_CLASS} whitespace-nowrap ${TOTALS_TONE_CLASS[totals.tone]}`}>
          {m.capacity_overview_percent({ pct: String(totals.committedPct) })}
        </span>
        {totals.overDays > 0 ? (
          <span className={`${MONO_DETAIL_CLASS} text-danger`}>
            {m.capacity_overview_over_short({ days: formatDayFigure(totals.overDays) })}
          </span>
        ) : (
          <span className={`${MONO_DETAIL_CLASS} text-faint`}>{formatDays(totals.freeDays, "capacity")}</span>
        )}
      </div>
      <div className="mt-[5px] flex h-1 overflow-hidden rounded-full bg-line-soft">
        <div
          data-testid="capacity-totals-committed"
          className="bg-brand"
          style={{ width: `${totals.committedPct}%` }}
        />
        <div
          data-testid="capacity-totals-tentative"
          style={{ width: `${totals.tentativePct}%`, background: TENTATIVE_HATCH }}
        />
      </div>
    </td>
  );
}
