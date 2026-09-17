import { m } from "@/i18n";
import {
  capacityDaysOf,
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
import type { CapacityOverviewPeriodResult } from "./capacityOverviewTypes";

const WEEK_CELL_CLASS = "border-b border-l border-line-soft p-0 align-middle";
const MONO_VALUE_CLASS = "font-mono text-[12.5px] font-medium tabular-nums";
const MONO_DETAIL_CLASS = "font-mono text-[10.5px] tabular-nums text-faint";

const TOTALS_TONE_CLASS: Record<CapacityTotalsTone, string> = {
  danger: "text-danger",
  ink: "text-ink",
  muted: "text-muted-foreground",
};

function UnassignedValue({ result }: { result: CapacityOverviewPeriodResult }) {
  return (
    <div className="px-3.5 py-[9px]">
      {result.unassignedDemandDays > 0 ? (
        <span className={MONO_VALUE_CLASS}>{formatDays(result.unassignedDemandDays, "unassigned")}</span>
      ) : (
        <span className={`${MONO_VALUE_CLASS} text-faint`}>—</span>
      )}
    </div>
  );
}

function ledgerValueInk(result: CapacityOverviewPeriodResult): string {
  if (result.freeDays > 0) return "text-ink";
  return result.overDays > 0 ? "text-danger" : "text-faint";
}

function LedgerValue({ result, label }: { result: CapacityOverviewPeriodResult; label: string }) {
  const fill = computeCapacityCellFill(result);
  const over = result.overDays > 0;
  // Overbooking is a cue on the track (red hatch, WCAG 1.4.1) plus the figure in the hover text and
  // for assistive technology: a printed label would wrap inside narrow twelve-week cells.
  return (
    <div className="flex flex-col gap-[5px] px-3.5 py-[9px]">
      <div className="flex items-baseline justify-between gap-1.5">
        <span className={`${MONO_VALUE_CLASS} ${ledgerValueInk(result)}`}>
          {result.freeDays > 0 ? formatDays(result.freeDays, "capacity") : "—"}
        </span>
        <span className={MONO_DETAIL_CLASS}>
          {m.capacity_overview_capacity_days({ days: formatDayFigure(capacityDaysOf(result)) })}
        </span>
      </div>
      <div
        className="flex h-[5px] overflow-hidden rounded-full bg-line-soft"
        data-testid="capacity-ledger-bar"
        data-over={over ? "true" : undefined}
        style={over ? { background: `${OVERBOOKED_HATCH}, var(--color-line-soft)` } : undefined}
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
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

function LoadCurveValue({ result, label }: { result: CapacityOverviewPeriodResult; label: string }) {
  const fill = computeCapacityCellFill(result);
  const over = result.overDays > 0;
  return (
    <div className="px-3.5 py-2.5">
      <div
        data-testid="capacity-load-curve"
        data-over={over ? "true" : undefined}
        className="flex h-[34px] flex-col justify-end overflow-hidden rounded-[5px] bg-line-soft"
        style={over ? { background: `${OVERBOOKED_HATCH}, var(--color-line-soft)` } : undefined}
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
        <span className={`${MONO_DETAIL_CLASS} whitespace-nowrap`}>{formatDays(totals.freeDays, "capacity")}</span>
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
