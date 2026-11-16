import { useFormLifetimeClose } from '@/hooks/useFormLifetimeClose';
import { useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import { useActiveScopedData, useScopedData } from '@/store/useScopedData';
import { useEditSubmit } from '@/hooks/useEditSubmit';
import { useFieldError } from '@/hooks/useFieldError';
import { parseName } from '@/lib/validation';
import { m } from '@/i18n';
import {
  FormActions,
  Modal,
  RequiredLegend,
  SegmentedField,
  SelectField,
  TextField,
} from '@/components/common/ui';
import type { Option } from '@/components/common/ui';
import { FieldError } from '@/components/ui/field';
import type { Activity, ActivityKind, Client, Project } from '@capacitylens/shared/types/entities';
import { ACTIVITY_KIND_ORDER } from './activityKinds';

// Resolved at render (a getter, not a module-scope const) so the labels re-resolve on a locale
// switch rather than freezing to the import-time locale, per the i18n key convention (DECISIONS).
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
  if (!activity?.projectId || projects.some((project) => project.id === activity.projectId)) {
    return options;
  }

  const rawProject = rawProjects.find((project) => project.id === activity.projectId);
  const rawClient = rawProject && rawClients.find((client) => client.id === rawProject.clientId);
  return [
    ...options,
    {
      value: activity.projectId,
      label: rawProject
        ? m.list_label_archived({
            name: rawClient ? `${rawClient.name} / ${rawProject.name}` : rawProject.name,
          })
        : m.form_option_current_archived(),
      disabled: true,
    },
  ];
}

function useActivityFields(activity?: Activity) {
  const [name, setName] = useState(activity?.name ?? '');
  const [kind, setKind] = useState<ActivityKind>(activity?.kind ?? 'project');
  const [projectId, setProjectId] = useState(activity?.projectId ?? '');
  const [phaseId, setPhaseId] = useState(activity?.phaseId ?? '');
  const changeKind = (next: ActivityKind) => {
    setKind(next);
    if (next !== 'project') {
      setProjectId('');
      setPhaseId('');
    }
  };
  const changeProject = (value: string) => {
    setProjectId(value);
    setPhaseId('');
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
  pending: boolean;
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
        invalid={props.errorField === 'name'}
        describedById={props.errorId}
        layout="label-control"
        disabled={props.pending}
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
        disabled={props.pending}
      />
      {props.kind === 'project' && (
        <SelectField
          label={m.form_activity_project_label()}
          value={props.projectId}
          onChange={props.changeProject}
          options={props.projectOptions}
          placeholder={m.form_activity_select_project_placeholder()}
          required
          invalid={props.errorField === 'project'}
          describedById={props.errorId}
          layout="label-control"
          disabled={props.pending}
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
  const baseOptions = useMemo(
    () => buildProjectOptions({ projects, clients }),
    [projects, clients],
  );
  if (!activity?.projectId || projects.some((project) => project.id === activity.projectId)) {
    return baseOptions;
  }
  return buildProjectOptions({
    projects,
    clients,
    rawProjects: raw.projects,
    rawClients: raw.clients,
    activity,
  });
}

/** Creates or edits an activity and closes after save or cancel. Only project activities carry project and phase attribution. */
export function ActivityForm({
  activity,
  onClose: close,
}: {
  activity?: Activity;
  onClose: () => void;
}) {
  const onClose = useFormLifetimeClose(close);
  const add = useStore((state) => state.addActivity);
  const update = useStore((state) => state.updateActivity);
  const { name, setName, kind, projectId, phaseId, changeKind, changeProject } =
    useActivityFields(activity);
  const { error, errorField, errorId, fail } = useFieldError();
  const projectOptions = useProjectOptions(activity);
  const activities = useStore((state) => state.data.activities);
  const { pending, submit } = useEditSubmit({
    editing: activity,
    rows: activities,
    staleMessage: m.form_activity_err_changed,
    fail,
    onSaved: onClose,
  });

  const prepareSave = () => {
    const trimmed = parseName(name, fail);
    if (!trimmed) return null;
    // A project-specific activity must have a project; internal/all-projects are project-less (projectId/phaseId
    // undefined). Surface the project requirement as a field error rather than relying on the
    // store throw, so the invalid control is marked.
    if (kind === 'project' && !projectId) {
      fail('project', m.form_activity_err_project_required());
      return null;
    }
    const patch = {
      name: trimmed,
      kind,
      ...(kind === 'project' && projectId ? { projectId } : {}),
      ...(kind === 'project' ? { phaseId: phaseId || null } : {}),
    };
    return activity ? () => update(activity.id, patch) : () => add(patch);
  };

  return (
    <Modal
      title={activity ? m.form_activity_edit_title() : m.form_activity_add_title()}
      onClose={onClose}
      onSubmit={() => {
        void submit(prepareSave);
      }}
      footer={<FormActions onCancel={onClose} disabled={pending} />}
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
        pending={pending}
      />
    </Modal>
  );
}
