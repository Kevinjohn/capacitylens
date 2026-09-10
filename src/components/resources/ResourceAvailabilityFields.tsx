import { m } from "@/i18n";
import { TextField, WorkingDayPicker } from "../common/ui";
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
      <TextField
        label={m.form_resource_first_available_date_label()}
        value={form.firstAvailableDate}
        onChange={form.setFirstAvailableDate}
        type="date"
        description={m.form_resource_availability_dates_description()}
        invalid={errorField === "firstAvailableDate"}
        describedById={errorId}
        layout="label-control"
      />
      <TextField
        label={m.form_resource_last_available_date_label()}
        value={form.lastAvailableDate}
        onChange={form.setLastAvailableDate}
        type="date"
        invalid={errorField === "lastAvailableDate"}
        describedById={errorId}
        layout="label-control"
      />
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
