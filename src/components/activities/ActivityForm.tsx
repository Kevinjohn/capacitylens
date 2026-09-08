import { useMemo, useState } from "react";
import { useStore } from "../../store/useStore";
import { useActiveScopedData, useScopedData } from "../../store/useScopedData";
import { useFieldError } from "../../hooks/useFieldError";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { validateName } from "../../lib/validation";
import { isStaleEdit } from "../../lib/isStaleEdit";
import { m } from "@/i18n";
import { FormActions, Modal, RequiredLegend, SegmentedField, SelectField, TextField, type Option } from "../common/ui";
import { FieldError } from "../ui/field";
import type { Activity, ActivityKind, Client, Project } from "@capacitylens/shared/types/entities";
import { ACTIVITY_KIND_ORDER } from "./activityKinds";

// Resolved at render (a getter, not a module-scope const) so the labels re-resolve on a locale
// switch rather than freezing to the import-time locale — per the i18n key convention (DECISIONS).
const buildKindOptions = (): { value: ActivityKind; label: string }[] => {
  const labels: Record<ActivityKind, string> = {
    internal: m.form_activity_kind_internal(),
    repeatable: m.form_activity_kind_repeatable(),
    project: m.form_activity_kind_project(),
  };
  return ACTIVITY_KIND_ORDER.map((value) => ({ value, label: labels[value] }));
};

interface ProjectOptionsInput {
  projects: Project[];
  clients: Client[];
  rawProjects?: Project[];
  rawClients?: Client[];
  activity?: Activity;
}

function buildProjectOptions({
  projects,
  clients,
  rawProjects = [],
  rawClients = [],
  activity,
}: ProjectOptionsInput): Option[] {
  const options = projects.map((project) => {
    const client = clients.find((candidate) => candidate.id === project.clientId);
    return { value: project.id, label: client ? `${client.name} / ${project.name}` : project.name };
  });
  if (!activity?.projectId || projects.some((project) => project.id === activity.projectId)) return options;

  const rawProject = rawProjects.find((project) => project.id === activity.projectId);
  const rawClient = rawProject && rawClients.find((client) => client.id === rawProject.clientId);
  return [
    ...options,
    {
      value: activity.projectId,
      label: rawProject
        ? m.list_label_archived({ name: rawClient ? `${rawClient.name} / ${rawProject.name}` : rawProject.name })
        : m.form_option_current_archived(),
      disabled: true,
    },
  ];
}

function useActivityFields(activity?: Activity) {
  const [name, setName] = useState(activity?.name ?? "");
  const [kind, setKind] = useState<ActivityKind>(activity?.kind ?? "project");
  const [projectId, setProjectId] = useState(activity?.projectId ?? "");
  const [phaseId, setPhaseId] = useState(activity?.phaseId ?? "");
  const changeKind = (next: ActivityKind) => {
    setKind(next);
    if (next !== "project") {
      setProjectId("");
      setPhaseId("");
    }
  };
  const changeProject = (value: string) => {
    setProjectId(value);
    setPhaseId("");
  };
  return { name, setName, kind, projectId, phaseId, changeKind, changeProject };
}

interface ActivityFieldsProps {
  name: string;
  setName: (value: string) => void;
  kind: ActivityKind;
  changeKind: (kind: ActivityKind) => void;
  projectId: string;
  changeProject: (projectId: string) => void;
  projectOptions: Option[];
  errorField: string | null;
  errorId: string;
  error: string | null;
}

function ActivityFields(props: ActivityFieldsProps) {
  return (
    <>
      <TextField
        label={m.form_activity_name_label()}
        value={props.name}
        onChange={props.setName}
        autoFocus
        required
        invalid={props.errorField === "name"}
        describedById={props.errorId}
        layout="label-control"
      />
      <SegmentedField
        label={m.form_activity_kind_label()}
        value={props.kind}
        onChange={props.changeKind}
        options={buildKindOptions()}
        ariaLabel={m.form_activity_kind_aria()}
        geometry="gapped"
        fullWidth
        density="compact"
        layout="label-control"
      />
      {props.kind === "project" && (
        <SelectField
          label={m.form_activity_project_label()}
          value={props.projectId}
          onChange={props.changeProject}
          options={props.projectOptions}
          placeholder={m.form_activity_select_project_placeholder()}
          required
          invalid={props.errorField === "project"}
          describedById={props.errorId}
          layout="label-control"
        />
      )}
      <FieldError id={props.errorId}>{props.error}</FieldError>
      <RequiredLegend />
    </>
  );
}

function useProjectOptions(activity?: Activity) {
  const { projects, clients } = useActiveScopedData();
  const raw = useScopedData();
  const baseOptions = useMemo(() => buildProjectOptions({ projects, clients }), [projects, clients]);
  if (!activity?.projectId || projects.some((project) => project.id === activity.projectId)) return baseOptions;
  return buildProjectOptions({ projects, clients, rawProjects: raw.projects, rawClients: raw.clients, activity });
}

/** Add (no `activity`) or edit an activity. Pick a kind first: a `project` activity takes a project (and keeps
 *  its phase); `internal`/all-projects (`repeatable`) are project-less, so the project picker is hidden and their
 *  project/phase forced empty. `onClose` fires on save or cancel. */
export function ActivityForm({ activity, onClose }: { activity?: Activity; onClose: () => void }) {
  const add = useStore((state) => state.addActivity);
  const update = useStore((state) => state.updateActivity);
  const { name, setName, kind, projectId, phaseId, changeKind, changeProject } = useActivityFields(activity);
  const { error, errorField, errorId, fail } = useFieldError();
  const projectOptions = useProjectOptions(activity);

  const submit = () => {
    const trimmed = validateName(name, fail);
    if (!trimmed) return;
    // A project-specific activity MUST have a project; internal/all-projects are project-less (projectId/phaseId
    // undefined). Surface the project requirement as a field error rather than relying on the
    // store throw, so the invalid control is marked.
    if (kind === "project" && !projectId) {
      fail("project", m.form_activity_err_project_required());
      return;
    }
    const patch = {
      name: trimmed,
      kind,
      ...(kind === "project" && projectId ? { projectId } : {}),
      ...(kind === "project" && phaseId ? { phaseId } : {}),
    };
    // Surface a store-side rejection as a form error rather than an uncaught React error — see the
    // store CRUD contract.
    try {
      if (activity) {
        if (isStaleEdit(useStore.getState().data.activities, activity.id, activity.updatedAt)) {
          fail(null, m.form_activity_err_changed());
          return;
        }
        update(activity.id, patch);
      } else {
        add(patch);
      }
      onClose();
    } catch (e) {
      fail(null, resolveErrorMessage(e));
    }
  };

  return (
    <Modal
      title={activity ? m.form_activity_edit_title() : m.form_activity_add_title()}
      onClose={onClose}
      onSubmit={submit}
      footer={<FormActions onCancel={onClose} />}
    >
      <ActivityFields
        name={name}
        setName={setName}
        kind={kind}
        changeKind={changeKind}
        projectId={projectId}
        changeProject={changeProject}
        projectOptions={projectOptions}
        errorField={errorField}
        errorId={errorId}
        error={error}
      />
    </Modal>
  );
}
