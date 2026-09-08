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

function newActivityPlaceholder(kind: AllocationTargetFieldsProps["activityScope"]["kind"]): string {
  if (kind === "internal") return m.form_allocation_new_internal_activity_placeholder();
  if (kind === "repeatable") return m.form_allocation_new_repeatable_activity_placeholder();
  return m.form_allocation_new_activity_placeholder();
}

function InlineActivityField({
  newActivityName,
  setNewActivityName,
  activityScope,
  errorField,
  errorId,
  onAddActivity,
}: Pick<
  AllocationTargetFieldsProps,
  "newActivityName" | "setNewActivityName" | "activityScope" | "errorField" | "errorId" | "onAddActivity"
>) {
  return (
    <AllocationControlColumn>
      <Field orientation="horizontal">
        <Input
          value={newActivityName}
          maxLength={MAX_NAME_INPUT_CODE_UNITS}
          placeholder={newActivityPlaceholder(activityScope.kind)}
          aria-label={m.form_allocation_new_activity_aria()}
          aria-invalid={errorField === "newactivity" || undefined}
          aria-describedby={errorField === "newactivity" ? errorId : undefined}
          onChange={(event) => setNewActivityName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
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
  );
}

function AssigneeFields({
  create,
  resourceId,
  onAssigneeChange,
  resourceOptions,
  isPlaceholder,
  errorField,
  errorId,
}: Pick<
  AllocationTargetFieldsProps,
  "create" | "resourceId" | "onAssigneeChange" | "resourceOptions" | "isPlaceholder" | "errorField" | "errorId"
>) {
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
    </>
  );
}

function ActivitySelectionFields({
  projectSelection,
  onProjectChange,
  projectOptions,
  activityId,
  setActivityId,
  activityOptions,
  errorField,
  errorId,
}: Pick<
  AllocationTargetFieldsProps,
  | "projectSelection"
  | "onProjectChange"
  | "projectOptions"
  | "activityId"
  | "setActivityId"
  | "activityOptions"
  | "errorField"
  | "errorId"
>) {
  return (
    <>
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
    </>
  );
}

export function AllocationTargetFields({
  create,
  resourceId,
  onAssigneeChange: changeAssignee,
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
  onAddActivity: addInlineActivity,
  errorField,
  errorId,
}: AllocationTargetFieldsProps) {
  return (
    <>
      <AssigneeFields
        create={create}
        resourceId={resourceId}
        onAssigneeChange={changeAssignee}
        resourceOptions={resourceOptions}
        isPlaceholder={isPlaceholder}
        errorField={errorField}
        errorId={errorId}
      />

      <ActivitySelectionFields
        projectSelection={projectSelection}
        onProjectChange={onProjectChange}
        projectOptions={projectOptions}
        activityId={activityId}
        setActivityId={setActivityId}
        activityOptions={activityOptions}
        errorField={errorField}
        errorId={errorId}
      />
      {inlineActivityCreateEnabled && canEdit && (
        <InlineActivityField
          newActivityName={newActivityName}
          setNewActivityName={setNewActivityName}
          activityScope={activityScope}
          errorField={errorField}
          errorId={errorId}
          onAddActivity={addInlineActivity}
        />
      )}
    </>
  );
}
