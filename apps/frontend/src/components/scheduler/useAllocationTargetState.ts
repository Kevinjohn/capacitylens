import { m } from "@/i18n";
import { effectiveProjectId } from "@capacitylens/shared/lib/integrity";
import type { Activity, Resource } from "@capacitylens/shared/types/entities";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { resolveResourceDisplayName } from "@/lib/metadata";
import { parseText } from "@/lib/validation";
import type { PlanningActions } from "@/data/planning/planningActions";
import type { Option } from "@/components/common/ui";
import {
  buildActivityOptions,
  resolveGroupKeyForKind,
  resolveGroupLabelForKind,
  sortGroupedOptions,
} from "./activityOptions";

import type { AppData } from "@capacitylens/shared/types/entities";
import type { FieldError } from "@/hooks/useFieldError";
import type { AllocationModalSeed } from "./buildAllocationModalSeed";
import {
  isActivityInProjectSelection,
  buildActivityScope,
  ANY_PROJECT_SELECTION,
  resolveAttributedProject,
  INTERNAL_PROJECT_SELECTION,
} from "./allocationModalSelection";

type TargetData = Pick<AppData, "activities" | "clients" | "phases" | "projects" | "resources">;

interface TargetInput {
  data: TargetData;
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
  addActivity: PlanningActions["addActivity"];
  runWhileBusy: <Result>(command: () => Promise<Result>) => Promise<Result | undefined>;
  onInlineActivityCreated: () => boolean;
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

function buildProjectOptions(
  data: Pick<TargetData, "clients" | "projects">,
  lockedProjectId: string | undefined,
): Option[] {
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
  const lockedProjectId =
    selectedResource?.kind === "placeholder" ? (selectedResource.projectId ?? undefined) : undefined;
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
  runWhileBusy,
  onInlineActivityCreated,
  fail,
  setInlineActivityOption,
  setActivityId,
  setNewActivityName,
}: Pick<TargetInput, "canEdit" | "addActivity" | "fail"> & {
  newActivityName: string;
  activityScope: ReturnType<typeof buildActivityScope>;
  runWhileBusy: TargetInput["runWhileBusy"];
  onInlineActivityCreated: TargetInput["onInlineActivityCreated"];
  setInlineActivityOption: React.Dispatch<
    React.SetStateAction<(Option & { kind: Activity["kind"]; projectId?: string }) | null>
  >;
  setActivityId: React.Dispatch<React.SetStateAction<string>>;
  setNewActivityName: React.Dispatch<React.SetStateAction<string>>;
}) {
  return () =>
    runWhileBusy(async () => {
      if (!canEdit) return;
      const cleanActivityName = parseText(newActivityName, fail, {
        field: "newactivity",
        requiredMessage: m.form_allocation_err_new_activity_name(),
      });
      if (cleanActivityName === null) return;
      try {
        const activity = await addActivity({ name: cleanActivityName, ...activityScope });
        if (activity.kind === "blocked") return;
        if (!onInlineActivityCreated()) {
          fail(null, "Company data changed while adding the activity. Reopen this form before saving.");
          return;
        }
        flushSync(() => {
          setInlineActivityOption({
            value: activity.value.id,
            label: activity.value.name,
            kind: activity.value.kind,
            ...(activity.value.projectId ? { projectId: activity.value.projectId } : {}),
          });
        });
        setActivityId(activity.value.id);
        setNewActivityName("");
      } catch (error) {
        // Report inline-creation failure without treating the new target as successfully selected.
        fail(null, error instanceof Error ? error.message : m.form_allocation_err_save_failed());
      }
    });
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

/** Tracks resource and activity selections for an allocation draft. */
export function useAllocationTargetState(input: TargetInput) {
  const { seed, resourceById: resourcesById, canEdit } = input;
  const {
    inlineActivityCreateEnabled,
    fail,
    clear,
    errorField,
    errorId,
    addActivity,
    runWhileBusy,
    onInlineActivityCreated,
  } = input;
  const { create } = seed;
  const fieldState = useTargetFieldState(seed);
  const { resourceId, projectSelection, activityId, setActivityId } = fieldState;
  const { newActivityName, setNewActivityName, setInlineActivityOption } = fieldState;
  // Keep an allocation's current assignee available during editing even when the company hides that resource kind, or saving could silently reassign the work.
  const choices = useTargetChoices({ ...input, ...fieldState, resourcesById });
  const { changeAssignee, changeProject } = useTargetChangeHandlers({ ...fieldState, resourcesById, clear });
  const addInlineActivity = useAddInlineActivity({
    canEdit,
    newActivityName,
    activityScope: choices.activityScope,
    runWhileBusy,
    onInlineActivityCreated,
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
