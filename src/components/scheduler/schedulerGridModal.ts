import { formatUtilizationPercent } from "../../lib/formatUtilizationPercent";
import type { RowModel } from "./schedulerModel";
import { isCapacityTracked } from "@capacitylens/shared/types/entities";
import type { ID, ISODate } from "@capacitylens/shared/types/entities";

/** The mean visible-window utilisation of the capacity-tracked rows, formatted for display — "0"
 *  when there are none. External rows carry no capacity, so the headline and per-group figures
 *  both exclude them here. */
export function buildAverageUtilizationLabel(rows: RowModel[]): string {
  const trackedRows = rows.filter((row) => isCapacityTracked(row.resource));
  return trackedRows.length
    ? formatUtilizationPercent(trackedRows.reduce((sum, row) => sum + row.utilization, 0) / trackedRows.length)
    : "0";
}

export type ModalState =
  | { kind: "edit"; allocationId: ID }
  | { kind: "create"; resourceId: ID; startDate: ISODate; endDate: ISODate }
  | { kind: "timeoff"; resourceId: ID; startDate: ISODate; endDate: ISODate };
