import { m } from "@/i18n";
import { DateField, WorkingDayPicker } from "../common/ui";
import { Separator } from "../ui/separator";
import type { ResourceFormState } from "./useResourceFormState";

type ResourceAvailabilityFieldsState = Pick<
  ResourceFormState,
  | "workingDays"
  | "setWorkingDays"
  | "halfDays"
  | "setHalfDays"
  | "firstAvailableDate"
  | "setFirstAvailableDate"
  | "lastAvailableDate"
  | "setLastAvailableDate"
>;

type ResourceAvailabilityFieldsProps = {
  form: ResourceAvailabilityFieldsState;
  errorField: string | null;
  errorId: string;
};

/** Edit a person's inclusive availability dates and normal working pattern. */
export function ResourceAvailabilityFields({ form, errorField, errorId }: ResourceAvailabilityFieldsProps) {
  return (
    <>
      <Separator className="my-4" />
      <div data-resource-availability-date-row className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <DateField
          label={m.form_resource_first_available_date_label()}
          value={form.firstAvailableDate}
          onChange={form.setFirstAvailableDate}
          invalid={errorField === "firstAvailableDate"}
          describedById={errorId}
        />
        <DateField
          label={m.form_resource_last_available_date_label()}
          value={form.lastAvailableDate}
          onChange={form.setLastAvailableDate}
          invalid={errorField === "lastAvailableDate"}
          describedById={errorId}
        />
      </div>
      <Separator className="my-4" />
      <WorkingDayPicker
        label={m.form_resource_working_days_label()}
        workingDays={form.workingDays}
        halfDays={form.halfDays}
        onChange={(workingDays, halfDays) => {
          form.setWorkingDays(workingDays);
          form.setHalfDays(halfDays);
        }}
        invalid={errorField === "workingDays"}
        describedById={errorId}
      />
    </>
  );
}
