import { m } from "@/i18n";
import { effectiveProjectId } from "@capacitylens/shared/lib/integrity";
import type { Activity, Resource } from "@capacitylens/shared/types/entities";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { resolveResourceDisplayName } from "../../lib/metadata";
import { validateText } from "../../lib/validation";
import type { useStore } from "../../store/useStore";
import type { Option } from "../common/ui";
import {
  buildActivityOptions,
  resolveGroupKeyForKind,
  resolveGroupLabelForKind,
  sortGroupedOptions,
} from "./activityOptions";

import type { AppData } from "@capacitylens/shared/types/entities";
import type { FieldError } from "../../hooks/useFieldError";
import type { AllocationModalSeed } from "./buildAllocationModalSeed";
import {
  isActivityInProjectSelection,
  buildActivityScope,
  ANY_PROJECT_SELECTION,
  resolveAttributedProject,
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

function describeResource(resource: Resource): string {
  let suffix = "";
  if (resource.kind === "placeholder") suffix = m.form_allocation_resource_slot_suffix();
  if (resource.kind === "external") suffix = m.form_allocation_resource_external_suffix();
  return `${resolveResourceDisplayName(resource)}${suffix}`;
}

function buildResourceOptions({
  resources,
  selectedResourceId,
  placeholdersEnabled,
  externalEnabled,
}: {
  resources: Resource[];
  selectedResourceId: string;
  placeholdersEnabled: boolean;
  externalEnabled: boolean;
}): Option[] {
  return resources
    .filter((resource) => placeholdersEnabled || resource.kind !== "placeholder" || resource.id === selectedResourceId)
    .filter((resource) => externalEnabled || !isExternalResource(resource) || resource.id === selectedResourceId)
    .map((resource) => ({ value: resource.id, label: describeResource(resource) }));
}

function buildProjectOptions(data: AppData, lockedProjectId: string | undefined): Option[] {
  const clientNamesById = new Map(data.clients.map((client) => [client.id, client.name]));
  const projects = data.projects
    .filter((project) => lockedProjectId === undefined || project.id === lockedProjectId)
    .toSorted((left, right) => {
      const clientOrder = (clientNamesById.get(left.clientId) ?? "").localeCompare(
        clientNamesById.get(right.clientId) ?? "",
        undefined,
        { sensitivity: "base" },
      );
      return (
        clientOrder ||
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
        left.id.localeCompare(right.id)
      );
    });
  return [
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
    ...projects.map((project, index) => {
      const clientName = clientNamesById.get(project.clientId);
      return {
        value: project.id,
        label: clientName ? `${clientName} / ${project.name}` : project.name,
        separatorBefore: index === 0,
      };
    }),
  ];
}

function addInlineOption(
  baseOptions: Option[],
  inlineOption: (Option & { kind: Activity["kind"]; projectId?: string }) | null,
  projectSelection: string,
): Option[] {
  if (
    !inlineOption ||
    !isActivityInProjectSelection(inlineOption, projectSelection) ||
    baseOptions.some((option) => option.value === inlineOption.value)
  ) {
    return baseOptions;
  }
  if (projectSelection === INTERNAL_PROJECT_SELECTION || projectSelection === ANY_PROJECT_SELECTION) {
    return sortGroupedOptions([...baseOptions, inlineOption]);
  }
  return sortGroupedOptions([
    ...baseOptions,
    {
      ...inlineOption,
      groupKey: resolveGroupKeyForKind(inlineOption.kind),
      groupLabel: resolveGroupLabelForKind(inlineOption.kind),
    },
  ]);
}

function resolveSelectedEffectiveProjectId(
  selectedActivity: Activity | undefined,
  attributedProjectId: string | undefined,
) {
  if (!selectedActivity) return undefined;
  return effectiveProjectId(attributedProjectId ? { projectId: attributedProjectId } : {}, selectedActivity);
}

type TargetChoicesInput = Pick<TargetInput, "data" | "placeholdersEnabled" | "externalEnabled"> & {
  resourcesById: Map<string, Resource>;
  resourceId: string;
  projectSelection: string;
  activityId: string;
  inlineActivityOption: (Option & { kind: Activity["kind"]; projectId?: string }) | null;
};

function useTargetChoices(input: TargetChoicesInput) {
  const { data, resourcesById, resourceId, projectSelection, activityId, inlineActivityOption } = input;
  const { placeholdersEnabled, externalEnabled } = input;
  const selectedActivity = useMemo(
    () => data.activities.find((activity) => activity.id === activityId),
    [activityId, data.activities],
  );
  const attributedProjectId = resolveAttributedProject(selectedActivity, projectSelection);
  const selectedEffectiveProjectId = useMemo(
    () => resolveSelectedEffectiveProjectId(selectedActivity, attributedProjectId),
    [attributedProjectId, selectedActivity],
  );
  const selectedResource = resourcesById.get(resourceId);
  const lockedProjectId = selectedResource?.kind === "placeholder" ? selectedResource.projectId : undefined;
  const resourceOptions = buildResourceOptions({
    resources: data.resources,
    selectedResourceId: resourceId,
    placeholdersEnabled,
    externalEnabled,
  });
  const projectOptions = buildProjectOptions(data, lockedProjectId);
  const activityScope = buildActivityScope(projectSelection);
  const baseActivityOptions = useMemo(
    () =>
      buildActivityOptions({
        activities: data.activities,
        phases: data.phases,
        projects: data.projects,
        kind: activityScope.kind,
        projectId: activityScope.projectId,
      }),
    [activityScope.kind, activityScope.projectId, data.activities, data.phases, data.projects],
  );
  const activityOptions = useMemo(
    () => addInlineOption(baseActivityOptions, inlineActivityOption, projectSelection),
    [baseActivityOptions, inlineActivityOption, projectSelection],
  );
  return {
    selectedActivity,
    attributedProjectId,
    selectedEffectiveProjectId,
    selectedResource,
    isPlaceholder: selectedResource?.kind === "placeholder",
    resourceOptions,
    projectOptions,
    activityScope,
    activityOptions,
  };
}

function useAddInlineActivity({
  canEdit,
  newActivityName,
  activityScope,
  addActivity,
  fail,
  setInlineActivityOption,
  setActivityId,
  setNewActivityName,
}: Pick<TargetInput, "canEdit" | "addActivity" | "fail"> & {
  newActivityName: string;
  activityScope: ReturnType<typeof buildActivityScope>;
  setInlineActivityOption: React.Dispatch<
    React.SetStateAction<(Option & { kind: Activity["kind"]; projectId?: string }) | null>
  >;
  setActivityId: React.Dispatch<React.SetStateAction<string>>;
  setNewActivityName: React.Dispatch<React.SetStateAction<string>>;
}) {
  return () => {
    if (!canEdit) return;
    const cleanActivityName = validateText(newActivityName, fail, {
      field: "newactivity",
      requiredMessage: m.form_allocation_err_new_activity_name(),
    });
    if (cleanActivityName === null) return;
    try {
      const activity = addActivity({ name: cleanActivityName, ...activityScope });
      flushSync(() => {
        setInlineActivityOption({
          value: activity.id,
          label: activity.name,
          kind: activity.kind,
          ...(activity.projectId ? { projectId: activity.projectId } : {}),
        });
      });
      setActivityId(activity.id);
      setNewActivityName("");
    } catch (error) {
      fail(null, error instanceof Error ? error.message : m.form_allocation_err_save_failed());
    }
  };
}

function useTargetChangeHandlers({
  resourcesById,
  clear,
  setResourceId,
  setProjectSelection,
  setActivityId,
}: Pick<TargetInput, "clear"> & {
  resourcesById: Map<string, Resource>;
  setResourceId: React.Dispatch<React.SetStateAction<string>>;
  setProjectSelection: React.Dispatch<React.SetStateAction<string>>;
  setActivityId: React.Dispatch<React.SetStateAction<string>>;
}) {
  const changeAssignee = (value: string) => {
    clear();
    setResourceId(value);
    const resource = resourcesById.get(value);
    if (resource?.kind === "placeholder" && resource.projectId) {
      setProjectSelection(resource.projectId);
      setActivityId("");
    }
  };
  const changeProject = (value: string) => {
    clear();
    setProjectSelection(value);
    setActivityId("");
  };
  return { changeAssignee, changeProject };
}

function useTargetFieldState(seed: AllocationModalSeed) {
  const [resourceId, setResourceId] = useState(seed.initialResourceId);
  const [projectSelection, setProjectSelection] = useState(seed.initialLocked ?? INTERNAL_PROJECT_SELECTION);
  const [activityId, setActivityId] = useState(seed.editing?.activityId ?? "");
  const [newActivityName, setNewActivityName] = useState("");
  const [inlineActivityOption, setInlineActivityOption] = useState<
    (Option & { kind: Activity["kind"]; projectId?: string }) | null
  >(null);
  return {
    resourceId,
    setResourceId,
    projectSelection,
    setProjectSelection,
    activityId,
    setActivityId,
    newActivityName,
    setNewActivityName,
    inlineActivityOption,
    setInlineActivityOption,
  };
}

export function useAllocationTargetState(input: TargetInput) {
  const { seed, resourceById: resourcesById, canEdit } = input;
  const { inlineActivityCreateEnabled, fail, clear, errorField, errorId, addActivity } = input;
  const { create } = seed;
  const fieldState = useTargetFieldState(seed);
  const { resourceId, projectSelection, activityId, setActivityId } = fieldState;
  const { newActivityName, setNewActivityName, setInlineActivityOption } = fieldState;
  // Placeholders and externals are each gated behind a per-account pref (both default OFF). When
  // off, drop them from the assignee picker — EXCEPT the allocation's currently-selected resource
  // (risk A): keep a hidden placeholder/external in the options when it's the one already assigned,
  // so editing shows the correct value in the chooser instead of silently reassigning the work to
  // someone else on save.
  const choices = useTargetChoices({ ...input, ...fieldState, resourcesById });
  const { changeAssignee, changeProject } = useTargetChangeHandlers({ ...fieldState, resourcesById, clear });
  const addInlineActivity = useAddInlineActivity({
    canEdit,
    newActivityName,
    activityScope: choices.activityScope,
    addActivity,
    fail,
    setInlineActivityOption,
    setActivityId,
    setNewActivityName,
  });

  return {
    selectedResource: choices.selectedResource,
    selectedActivity: choices.selectedActivity,
    attributedProjectId: choices.attributedProjectId,
    selectedEffectiveProjectId: choices.selectedEffectiveProjectId,
    fields: {
      create,
      resourceId,
      onAssigneeChange: changeAssignee,
      resourceOptions: choices.resourceOptions,
      isPlaceholder: choices.isPlaceholder,
      projectSelection,
      onProjectChange: changeProject,
      projectOptions: choices.projectOptions,
      activityId,
      setActivityId,
      activityOptions: choices.activityOptions,
      inlineActivityCreateEnabled,
      canEdit,
      newActivityName,
      setNewActivityName,
      activityScope: choices.activityScope,
      onAddActivity: addInlineActivity,
      errorField,
      errorId,
    },
  };
}
