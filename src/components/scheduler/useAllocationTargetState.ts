import { m } from "@/i18n";
import { effectiveProjectId } from "@capacitylens/shared/lib/integrity";
import type { Activity, Resource } from "@capacitylens/shared/types/entities";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { resourceDisplayName } from "../../lib/metadata";
import { validateText } from "../../lib/validation";
import type { useStore } from "../../store/useStore";
import type { Option } from "../common/ui";
import { buildActivityOptions, groupKeyForKind, groupLabelForKind, sortGroupedOptions } from "./activityOptions";

import type { AppData } from "@capacitylens/shared/types/entities";
import type { FieldError } from "../../hooks/useFieldError";
import type { AllocationModalSeed } from "./allocationModalSeed";
import {
  activityBelongsToProjectSelection,
  activityScopeForProjectSelection,
  ANY_PROJECT_SELECTION,
  attributedProjectForSelection,
  INTERNAL_PROJECT_SELECTION,
} from "./allocationModalSelection";
interface TargetInput {
  data: AppData;
  seed: AllocationModalSeed;
  resourceById: Map<string, Resource>;
  canEdit: boolean;
  placeholdersEnabled: boolean;
  externalEnabled: boolean;
  inlineActivityCreateEnabled: boolean;
  fail: FieldError["fail"];
  clear: FieldError["clear"];
  errorField: FieldError["errorField"];
  errorId: string;
  addActivity: ReturnType<typeof useStore.getState>["addActivity"];
}
export function useAllocationTargetState({
  data,
  seed,
  resourceById,
  canEdit,
  placeholdersEnabled,
  externalEnabled,
  inlineActivityCreateEnabled,
  fail,
  clear,
  errorField,
  errorId,
  addActivity,
}: TargetInput) {
  const { initialResourceId, initialLocked, editing, create } = seed;
  const [resourceId, setResourceId] = useState(initialResourceId);
  // `initialLocked` preserves the exact activity scope while editing and a placeholder's bound
  // project while creating, so legacy unattributed rows reopen in their original scope.
  const [projectSelection, setProjectSelection] = useState(initialLocked ?? INTERNAL_PROJECT_SELECTION);
  const [activityId, setActivityId] = useState(editing?.activityId ?? "");
  const [newActivityName, setNewActivityName] = useState("");
  const [inlineActivityOption, setInlineActivityOption] = useState<
    (Option & { kind: Activity["kind"]; projectId?: string }) | null
  >(null);
  const selectedActivity = useMemo(
    () => data.activities.find((activity) => activity.id === activityId),
    [activityId, data.activities],
  );
  const attributedProjectId = attributedProjectForSelection(selectedActivity, projectSelection);
  const selectedEffectiveProjectId = useMemo(
    () => (selectedActivity ? effectiveProjectId({ projectId: attributedProjectId }, selectedActivity) : undefined),
    [attributedProjectId, selectedActivity],
  );
  const selectedResource = resourceById.get(resourceId);
  const isPlaceholder = selectedResource?.kind === "placeholder";
  const lockedProjectId = isPlaceholder ? selectedResource?.projectId : undefined;
  // Placeholders and externals are each gated behind a per-account pref (both default OFF). When
  // off, drop them from the assignee picker — EXCEPT the allocation's currently-selected resource
  // (risk A): keep a hidden placeholder/external in the options when it's the one already assigned,
  // so editing shows the correct value in the chooser instead of silently reassigning the work to
  // someone else on save.
  const resourceOptions: Option[] = data.resources
    .filter((r) => placeholdersEnabled || r.kind !== "placeholder" || r.id === resourceId)
    .filter((r) => externalEnabled || !isExternalResource(r) || r.id === resourceId)
    .map((r) => ({
      value: r.id,
      label: `${resourceDisplayName(r)}${
        r.kind === "placeholder"
          ? m.form_allocation_resource_slot_suffix()
          : r.kind === "external"
            ? m.form_allocation_resource_external_suffix()
            : ""
      }`,
    }));
  const clientNameById = new Map(data.clients.map((client) => [client.id, client.name]));
  const sortedProjects = data.projects
    .filter((project) => (lockedProjectId ? project.id === lockedProjectId : true))
    .toSorted((left, right) => {
      const clientOrder = (clientNameById.get(left.clientId) ?? "").localeCompare(
        clientNameById.get(right.clientId) ?? "",
        undefined,
        { sensitivity: "base" },
      );
      return (
        clientOrder ||
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
        left.id.localeCompare(right.id)
      );
    });
  const projectOptions: Option[] = [
    {
      value: INTERNAL_PROJECT_SELECTION,
      label: m.form_allocation_project_internal(),
      disabled: lockedProjectId !== undefined,
    },
    {
      value: ANY_PROJECT_SELECTION,
      label: m.form_allocation_project_any(),
      disabled: lockedProjectId !== undefined,
    },
    ...sortedProjects.map((project, index) => {
      const clientName = clientNameById.get(project.clientId);
      return {
        value: project.id,
        label: clientName ? `${clientName} / ${project.name}` : project.name,
        separatorBefore: index === 0,
      };
    }),
  ];
  const activityScope = activityScopeForProjectSelection(projectSelection);
  const baseActivityOptions = useMemo(
    () =>
      buildActivityOptions(data.activities, data.phases, data.projects, activityScope.kind, activityScope.projectId),
    [activityScope.kind, activityScope.projectId, data.activities, data.phases, data.projects],
  );
  const activityOptions = useMemo(() => {
    if (
      inlineActivityOption &&
      activityBelongsToProjectSelection(inlineActivityOption, projectSelection) &&
      !baseActivityOptions.some((option) => option.value === inlineActivityOption.value)
    ) {
      const option =
        projectSelection !== INTERNAL_PROJECT_SELECTION && projectSelection !== ANY_PROJECT_SELECTION
          ? {
              ...inlineActivityOption,
              groupKey: groupKeyForKind(inlineActivityOption.kind),
              groupLabel: groupLabelForKind(inlineActivityOption.kind),
            }
          : inlineActivityOption;
      return sortGroupedOptions([...baseActivityOptions, option]);
    }
    return baseActivityOptions;
  }, [baseActivityOptions, inlineActivityOption, projectSelection]);
  const onAssigneeChange = (v: string) => {
    clear();
    setResourceId(v);
    const r = resourceById.get(v);
    if (r?.kind === "placeholder" && r.projectId) {
      // A placeholder forces its bound project; reset downstream selections.
      setProjectSelection(r.projectId);
      setActivityId("");
    }
  };
  const onProjectChange = (v: string) => {
    clear();
    setProjectSelection(v);
    setActivityId("");
  };
  const onAddActivity = () => {
    if (!canEdit) return;
    const cleanActivityName = validateText(newActivityName, fail, {
      field: "newactivity",
      requiredMessage: m.form_allocation_err_new_activity_name(),
    });
    if (cleanActivityName === null) return;
    try {
      const activity = addActivity({ name: cleanActivityName, ...activityScope });
      // Radix must register a newly inserted item before its controlled value can select it.
      flushSync(() => {
        setInlineActivityOption({
          value: activity.id,
          label: activity.name,
          kind: activity.kind,
          projectId: activity.projectId,
        });
      });
      setActivityId(activity.id);
      setNewActivityName("");
    } catch (error) {
      fail(null, error instanceof Error ? error.message : m.form_allocation_err_save_failed());
    }
  };

  return {
    selectedResource,
    selectedActivity,
    attributedProjectId,
    selectedEffectiveProjectId,
    fields: {
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
    },
  };
}
