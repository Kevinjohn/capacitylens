import { formatUtilizationPercent } from "../../lib/formatUtilizationPercent";
import type { RowModel } from "./schedulerModel";
import type { ID, ISODate } from "@capacitylens/shared/types/entities";

/** The mean of the rows' visible-window utilisation, formatted for display — "0" for no rows.
 *  Shared by the headline and per-group figures; both callers pass only capacity-tracked rows. */
export function buildAverageUtilizationLabel(rows: RowModel[]): string {
  return rows.length
    ? formatUtilizationPercent(rows.reduce((sum, row) => sum + row.utilization, 0) / rows.length)
    : "0";
}

export type ModalState =
  | { kind: "edit"; allocationId: ID }
  | { kind: "create"; resourceId: ID; startDate: ISODate; endDate: ISODate }
  | { kind: "timeoff"; resourceId: ID; startDate: ISODate; endDate: ISODate };
