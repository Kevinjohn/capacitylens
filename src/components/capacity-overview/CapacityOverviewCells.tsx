import { m } from "@/i18n";
import {
  computeCapacityCellFill,
  describePeriod,
  describeTotals,
  formatDayFigure,
  formatDays,
  OVERBOOKED_HATCH,
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

/** Red hatch painted above the fills so a full free bar cannot hide an overbooked week. */
function OverbookedHatch() {
  return (
    <div
      aria-hidden="true"
      data-testid="capacity-overbooked-hatch"
      className="pointer-events-none absolute inset-0"
      style={{ background: OVERBOOKED_HATCH }}
    />
  );
}

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

function LedgerValue({ result, label }: { result: CapacityOverviewPeriodResult; label: string }) {
  const fill = computeCapacityCellFill(result);
  const over = result.overDays > 0;
  // An overbooked week swaps the capacity figure for the overbooked days in red (the long
  // "overbooked" label wrapped inside twelve-week cells) and hatches the track (WCAG 1.4.1).
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
      <div
        className="relative flex h-[5px] overflow-hidden rounded-full bg-line-soft"
        data-testid="capacity-ledger-bar"
        data-over={over ? "true" : undefined}
      >
        <div
          data-testid="capacity-bar-free"
          data-tone={fill.tone}
          style={{ width: `${fill.freeFraction * 100}%`, background: TONE_FILL[fill.tone] }}
        />
        <div
          data-testid="capacity-bar-tentative"
          style={{ width: `${fill.tentativeFraction * 100}%`, background: TENTATIVE_HATCH }}
        />
        {over ? <OverbookedHatch /> : null}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

function LoadCurveValue({ result, label }: { result: CapacityOverviewPeriodResult; label: string }) {
  const fill = computeCapacityCellFill(result);
  const over = result.overDays > 0;
  return (
    <div className={`px-3.5 py-2.5 ${COMPACT_ROW_CLASS}`}>
      <div
        data-testid="capacity-load-curve"
        data-over={over ? "true" : undefined}
        className="relative flex h-[34px] flex-col justify-end overflow-hidden rounded-[5px] bg-line-soft [[data-compact]_&]:h-5"
      >
        <div
          data-testid="capacity-bar-tentative"
          style={{ height: `${fill.tentativeFraction * 100}%`, background: TENTATIVE_HATCH }}
        />
        <div
          data-testid="capacity-bar-free"
          data-tone={fill.tone}
          style={{ height: `${fill.freeFraction * 100}%`, background: TONE_FILL[fill.tone] }}
        />
        {over ? <OverbookedHatch /> : null}
      </div>
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
      <div className="relative mt-[5px] flex h-1 overflow-hidden rounded-full bg-line-soft">
        <div
          data-testid="capacity-totals-committed"
          className="bg-brand"
          style={{ width: `${totals.committedPct}%` }}
        />
        <div
          data-testid="capacity-totals-tentative"
          style={{ width: `${totals.tentativePct}%`, background: TENTATIVE_HATCH }}
        />
        {totals.overDays > 0 ? <OverbookedHatch /> : null}
      </div>
    </td>
  );
}
