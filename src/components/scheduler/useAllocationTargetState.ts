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
export function useAllocationTargetState({
  data,
  seed,
  resourceById: resourcesById,
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
  const attributedProjectId = resolveAttributedProject(selectedActivity, projectSelection);
  const selectedEffectiveProjectId = useMemo(
    () =>
      selectedActivity
        ? effectiveProjectId(attributedProjectId ? { projectId: attributedProjectId } : {}, selectedActivity)
        : undefined,
    [attributedProjectId, selectedActivity],
  );
  const selectedResource = resourcesById.get(resourceId);
  const isPlaceholder = selectedResource?.kind === "placeholder";
  const lockedProjectId = isPlaceholder ? selectedResource?.projectId : undefined;
  // Placeholders and externals are each gated behind a per-account pref (both default OFF). When
  // off, drop them from the assignee picker — EXCEPT the allocation's currently-selected resource
  // (risk A): keep a hidden placeholder/external in the options when it's the one already assigned,
  // so editing shows the correct value in the chooser instead of silently reassigning the work to
  // someone else on save.
  const resourceOptions: Option[] = data.resources
    .filter((resource) => placeholdersEnabled || resource.kind !== "placeholder" || resource.id === resourceId)
    .filter((resource) => externalEnabled || !isExternalResource(resource) || resource.id === resourceId)
    .map((resource) => ({
      value: resource.id,
      label: `${resolveResourceDisplayName(resource)}${
        resource.kind === "placeholder"
          ? m.form_allocation_resource_slot_suffix()
          : resource.kind === "external"
            ? m.form_allocation_resource_external_suffix()
            : ""
      }`,
    }));
  const clientNamesById = new Map(data.clients.map((client) => [client.id, client.name]));
  const sortedProjects = data.projects
    .filter((project) => (lockedProjectId ? project.id === lockedProjectId : true))
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
      const clientName = clientNamesById.get(project.clientId);
      return {
        value: project.id,
        label: clientName ? `${clientName} / ${project.name}` : project.name,
        separatorBefore: index === 0,
      };
    }),
  ];
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
  const activityOptions = useMemo(() => {
    if (
      inlineActivityOption &&
      isActivityInProjectSelection(inlineActivityOption, projectSelection) &&
      !baseActivityOptions.some((option) => option.value === inlineActivityOption.value)
    ) {
      const option =
        projectSelection !== INTERNAL_PROJECT_SELECTION && projectSelection !== ANY_PROJECT_SELECTION
          ? {
              ...inlineActivityOption,
              groupKey: resolveGroupKeyForKind(inlineActivityOption.kind),
              groupLabel: resolveGroupLabelForKind(inlineActivityOption.kind),
            }
          : inlineActivityOption;
      return sortGroupedOptions([...baseActivityOptions, option]);
    }
    return baseActivityOptions;
  }, [baseActivityOptions, inlineActivityOption, projectSelection]);
  const onAssigneeChange = (value: string) => {
    clear();
    setResourceId(value);
    const resource = resourcesById.get(value);
    if (resource?.kind === "placeholder" && resource.projectId) {
      // A placeholder forces its bound project; reset downstream selections.
      setProjectSelection(resource.projectId);
      setActivityId("");
    }
  };
  const changeProject = (value: string) => {
    clear();
    setProjectSelection(value);
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
          ...(activity.projectId ? { projectId: activity.projectId } : {}),
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
      onProjectChange: changeProject,
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
