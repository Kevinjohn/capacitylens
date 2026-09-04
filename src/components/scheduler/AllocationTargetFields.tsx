import { Plus } from "lucide-react";
import { MAX_NAME_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { m } from "@/i18n";
import { SelectField } from "../common/ui";
import { Button } from "../ui/button";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { AllocationControlColumn } from "./AllocationModalFieldLayout";
import type { AllocationModalState } from "./useAllocationModalState";

type AllocationTargetFieldsProps = AllocationModalState["targetFields"];

export function AllocationTargetFields({
  create,
  resourceId,
  onAssigneeChange,
  resourceOptions,
  isPlaceholder,
  projectSelection,
  onProjectChange,
  projectOptions,
  activityId,
  setActivityId,
  activityOptions,
  inlineActivityCreateEnabled,
  canEdit,
  newActivityName,
  setNewActivityName,
  activityScope,
  onAddActivity,
  errorField,
  errorId,
}: AllocationTargetFieldsProps) {
  return (
    <>
      {!create && (
        <SelectField
          label={m.form_allocation_assignee_label()}
          value={resourceId}
          onChange={onAssigneeChange}
          options={resourceOptions}
          placeholder={m.form_allocation_select_resource_placeholder()}
          required
          invalid={errorField === "resource"}
          describedById={errorId}
          layout="label-control"
        />
      )}
      {isPlaceholder && (
        <AllocationControlColumn>
          <p className="text-xs text-muted-foreground">{m.form_allocation_placeholder_locked()}</p>
        </AllocationControlColumn>
      )}

      <SelectField
        label={m.form_allocation_project_label()}
        value={projectSelection}
        onChange={onProjectChange}
        options={projectOptions}
        layout="label-control"
      />
      <SelectField
        label={m.form_allocation_activity_label()}
        value={activityId}
        onChange={setActivityId}
        options={activityOptions}
        placeholder={m.form_allocation_select_activity_placeholder()}
        required
        invalid={errorField === "activity"}
        describedById={errorId}
        layout="label-control"
      />
      {inlineActivityCreateEnabled && canEdit && (
        <AllocationControlColumn>
          <Field orientation="horizontal">
            <Input
              value={newActivityName}
              maxLength={MAX_NAME_INPUT_CODE_UNITS}
              placeholder={
                activityScope.kind === "internal"
                  ? m.form_allocation_new_internal_activity_placeholder()
                  : activityScope.kind === "repeatable"
                    ? m.form_allocation_new_repeatable_activity_placeholder()
                    : m.form_allocation_new_activity_placeholder()
              }
              aria-label={m.form_allocation_new_activity_aria()}
              aria-invalid={errorField === "newactivity" || undefined}
              aria-describedby={errorField === "newactivity" ? errorId : undefined}
              onChange={(e) => setNewActivityName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAddActivity();
                }
              }}
            />
            <Button size="sm" type="button" variant="outline" onClick={onAddActivity}>
              <Plus data-icon="inline-start" />
              {m.form_allocation_add_activity()}
            </Button>
          </Field>
        </AllocationControlColumn>
      )}
    </>
  );
}
