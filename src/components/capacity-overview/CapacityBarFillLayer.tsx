import { capacityBarFillStyle } from "./capacityOverviewBar";
import type { CapacityBarFill, CapacityBarFillContext } from "./capacityOverviewBar";

// The fill paints as absolutely-positioned layers behind the cell's own text (kept in a `relative
// z-10` wrapper) rather than as a single `background` on the <td>, so the overbooked hatch can be
// confined to exactly the filled sub-region (its own div, sized to `fraction * 100%`) without
// distorting the pattern or bleeding into the grey portion above it.
//
// The outer wrapper is inset 3px from the cell edge (not 0) so adjacent bars read as separate
// cards with a 6px gap between them, both directions. This is done here, per-fill, rather than
// via `border-spacing` on the table: that spacing model paints a table-owned gutter between
// cells, which also strips every row's `border-b` divider (row borders don't apply in the
// separated-borders model) and breaks each row's continuous background into per-cell fragments.
export function CapacityBarFillLayer({ fill, context }: { fill: CapacityBarFill; context: CapacityBarFillContext }) {
  return (
    <div
      aria-hidden="true"
      data-testid="capacity-bar-fill-layer"
      className="pointer-events-none absolute inset-[3px]"
      style={{ background: "var(--color-line-soft)" }}
    >
      {fill.kind !== "none" && (
        <div
          data-testid="capacity-bar-fill"
          data-bar-kind={fill.kind}
          className="absolute inset-x-0 bottom-0"
          style={{ height: `${fill.fraction * 100}%`, ...capacityBarFillStyle(fill, context) }}
        />
      )}
    </div>
  );
}
