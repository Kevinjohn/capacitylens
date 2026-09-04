import type { ReactNode } from "react";
import type { ISODate } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { DateField } from "../common/ui";

/** Keeps compound controls and their supporting text inside the shared 75% control column. */
export function AllocationControlColumn({ children }: { children: ReactNode }) {
  return (
    <div data-allocation-control-column className="min-w-0 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] sm:gap-3">
      <span aria-hidden="true" className="hidden sm:block" />
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  );
}

/** The scheduling controls are the one deliberate exception to the modal's 25/75 rows. */
export function AllocationSpanRow({
  children,
  hint,
  columns,
}: {
  children: ReactNode;
  hint?: ReactNode;
  columns: 2 | 3;
}) {
  return (
    <div data-allocation-span-row className="flex min-w-0 flex-col gap-1.5">
      <div
        data-allocation-span-controls
        className={`grid min-w-0 grid-cols-1 gap-2 ${columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
      >
        {children}
      </div>
      {hint}
    </div>
  );
}

/** The raw Start/End pair, for the modes that take a literal date range rather than deriving the
 *  end from a span (see `usesTypedDateRange`). Both fields report the SAME `dates` error field, so
 *  they are invalid together — which is the reason they live in one component instead of two
 *  hand-kept copies that could drift apart. */
export function DateRangeFields({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  invalid,
  describedById,
}: {
  startDate: ISODate;
  endDate: ISODate;
  onStartChange: (value: ISODate) => void;
  onEndChange: (value: ISODate) => void;
  invalid: boolean;
  describedById?: string;
}) {
  return (
    <>
      <DateField
        label={m.form_allocation_start_date_label()}
        value={startDate}
        onChange={onStartChange}
        required
        invalid={invalid}
        describedById={describedById}
      />
      <DateField
        label={m.form_allocation_end_label()}
        value={endDate}
        onChange={onEndChange}
        required
        invalid={invalid}
        describedById={describedById}
      />
    </>
  );
}
