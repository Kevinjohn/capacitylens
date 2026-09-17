import { m } from "@/i18n";

/** Group rows and the legend strip sit a step below the card surface in both themes. */
export const SURFACE_2_CLASS = "bg-[color-mix(in_oklab,var(--color-ink)_4%,var(--color-surface))]";

const SWATCH_HATCH = "repeating-linear-gradient(45deg, var(--color-faint) 0 2px, transparent 2px 4px)";

/** The tentative hatch at swatch size, shared by the toolbar pill and the legend. */
export function TentativeSwatch({ size }: { size: 8 | 9 }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-[2px] outline outline-1 outline-faint"
      style={{ width: size, height: size, background: SWATCH_HATCH }}
    />
  );
}

function LegendItem({ children, swatch }: { children: string; swatch: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {swatch}
      {children}
    </span>
  );
}

export function OverviewLegend() {
  return (
    <div
      data-testid="capacity-overview-legend"
      className={`flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line-soft px-[18px] py-[11px] text-[11.5px] text-muted-foreground ${SURFACE_2_CLASS}`}
    >
      <LegendItem swatch={<span aria-hidden="true" className="size-2 rounded-[2px] bg-brand" />}>
        {m.capacity_overview_legend_committed()}
      </LegendItem>
      <LegendItem swatch={<TentativeSwatch size={8} />}>{m.capacity_overview_legend_tentative()}</LegendItem>
      <LegendItem
        swatch={
          <span aria-hidden="true" className="size-2 rounded-[2px] bg-line-soft outline outline-1 outline-line" />
        }
      >
        {m.capacity_overview_legend_free()}
      </LegendItem>
      <span className="ms-auto text-faint">{m.capacity_overview_legend_note()}</span>
    </div>
  );
}
