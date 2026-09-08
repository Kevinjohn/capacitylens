import { useMemo, useState } from "react";
import { useStore } from "../../store/useStore";
import { hasDisciplinesEnabled } from "../../store/selectors";
import { useActiveScopedData, useScopedData } from "../../store/useScopedData";
import { useFieldError } from "../../hooks/useFieldError";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { validateText, validateWorkingDays } from "../../lib/validation";
import { isStaleEdit } from "../../lib/isStaleEdit";
import { m } from "@/i18n";
import {
  FormActions,
  Modal,
  RequiredLegend,
  SelectField,
  TextField,
  WorkingDayPicker,
  type Option,
} from "../common/ui";
import { FieldError, FieldGroup } from "../ui/field";
import { buildResourceEngagementOptions } from "../../lib/metadata";
import { DEFAULT_COLORS } from "../../lib/palette";
import {
  FULL_DAY_HOURS,
  placeholderCapacityDefaults,
  type Client,
  type Discipline,
  type Project,
  type Resource,
  type ResourceEngagement,
  type ResourceKind,
  type Weekday,
} from "@capacitylens/shared/types/entities";

type ResourceFormProps = { resource?: Resource; kind?: ResourceKind; onClose: () => void };

function useResourceFormState(resource?: Resource) {
  const text = getInitialTextState(resource);
  const capacity = getInitialCapacityState(resource);
  const [name, setName] = useState(text.name);
  const [role, setRole] = useState(text.role);
  const [disciplineId, setDisciplineId] = useState(text.disciplineId);
  const [projectId, setProjectId] = useState(text.projectId);
  const [engagement, setEngagement] = useState<ResourceEngagement>(capacity.engagement);
  const [workingDays, setWorkingDays] = useState<Weekday[]>(capacity.workingDays);
  const [halfDays, setHalfDays] = useState<Weekday[]>(capacity.halfDays);
  return {
    name,
    setName,
    role,
    setRole,
    disciplineId,
    setDisciplineId,
    engagement,
    setEngagement,
    workingDays,
    setWorkingDays,
    halfDays,
    setHalfDays,
    projectId,
    setProjectId,
  };
}

function getInitialTextState(resource?: Resource) {
  return {
    name: resource?.name ?? "",
    role: resource?.role ?? "",
    disciplineId: resource?.disciplineId ?? "",
    projectId: resource?.projectId ?? "",
  };
}

function getInitialCapacityState(resource?: Resource) {
  return {
    engagement: resource?.engagement ?? "studio",
    workingDays: resource?.workingDays ?? [1, 2, 3, 4, 5],
    halfDays: resource?.halfDays ?? [],
  };
}

type FormState = ReturnType<typeof useResourceFormState>;
type ProjectOptionsInput = {
  resource: Resource | undefined;
  projects: Project[];
  clients: Client[];
  rawProjects: Project[];
  rawClients: Client[];
};

function useProjectOptions({ resource, projects, clients, rawProjects, rawClients }: ProjectOptionsInput) {
  const baseOptions: Option[] = useMemo(
    () =>
      projects.map((project) => {
        const client = clients.find((candidate) => candidate.id === project.clientId);
        return { value: project.id, label: client ? `${client.name} / ${project.name}` : project.name };
      }),
    [projects, clients],
  );
  if (!resource?.projectId || projects.some((project) => project.id === resource.projectId)) return baseOptions;
  const rawProject = rawProjects.find((project) => project.id === resource.projectId);
  const rawClient = rawProject && rawClients.find((client) => client.id === rawProject.clientId);
  const label = rawProject
    ? m.list_label_archived({ name: rawClient ? `${rawClient.name} / ${rawProject.name}` : rawProject.name })
    : m.form_option_current_archived();
  return [...baseOptions, { value: resource.projectId, label, disabled: true }];
}

function getFormTitle(resource: Resource | undefined, isPlaceholder: boolean) {
  if (resource) return isPlaceholder ? m.form_resource_edit_placeholder_title() : m.form_resource_edit_resource_title();
  return isPlaceholder ? m.form_resource_add_placeholder_title() : m.form_resource_add_resource_title();
}

type SubmitInput = {
  resource: Resource | undefined;
  kind: ResourceKind;
  isPlaceholder: boolean;
  form: FormState;
  fail: ReturnType<typeof useFieldError>["fail"];
  onClose: () => void;
  add: ReturnType<typeof useStore.getState>["addResource"];
  update: ReturnType<typeof useStore.getState>["updateResource"];
};

type ValidatedFields = { name: string; role: string };

function validateForm(form: FormState, isPlaceholder: boolean, fail: SubmitInput["fail"]): ValidatedFields | null {
  const name = validateText(form.name, fail, {
    field: "name",
    required: !isPlaceholder,
    requiredMessage: m.form_resource_err_name_required(),
  });
  if (name === null) return null;
  const role = validateText(form.role, fail, { field: "role", required: false });
  if (role === null) return null;
  if (isPlaceholder && !form.projectId) {
    fail("projectId", m.form_resource_err_placeholder_project());
    return null;
  }
  if (!isPlaceholder && !validateWorkingDays(form.workingDays, fail)) return null;
  return { name, role };
}

function buildResourcePatch(
  input: Pick<SubmitInput, "resource" | "kind" | "isPlaceholder" | "form">,
  fields: ValidatedFields,
) {
  const { resource, kind, isPlaceholder, form } = input;
  const basePatch = {
    name: fields.name || undefined,
    role: fields.role,
    disciplineId: form.disciplineId || undefined,
    employmentType: isPlaceholder ? ("permanent" as const) : (resource?.employmentType ?? "permanent"),
    engagement: isPlaceholder ? ("studio" as const) : form.engagement,
    workingHoursPerDay: FULL_DAY_HOURS,
    projectId: isPlaceholder ? form.projectId : undefined,
    color: resource?.color ?? DEFAULT_COLORS.resource,
  };
  return isPlaceholder
    ? { ...basePatch, kind: "placeholder" as const, ...placeholderCapacityDefaults() }
    : { ...basePatch, kind, workingDays: form.workingDays, halfDays: form.halfDays };
}

type ResourcePatch = ReturnType<typeof buildResourcePatch>;

function saveResource(input: SubmitInput, patch: ResourcePatch) {
  const { resource, fail, add, update } = input;
  if (resource) {
    if (isStaleEdit(useStore.getState().data.resources, resource.id, resource.updatedAt)) {
      fail(null, m.form_resource_err_changed());
      return false;
    }
    update(resource.id, patch);
    return true;
  }
  add({
    role: patch.role,
    employmentType: patch.employmentType,
    engagement: patch.engagement,
    workingHoursPerDay: patch.workingHoursPerDay,
    workingDays: patch.workingDays,
    halfDays: patch.halfDays,
    kind: patch.kind,
    color: patch.color,
    ...(patch.name ? { name: patch.name } : {}),
    ...(patch.disciplineId ? { disciplineId: patch.disciplineId } : {}),
    ...(patch.projectId ? { projectId: patch.projectId } : {}),
  });
  return true;
}

function createSubmit(input: SubmitInput) {
  return () => {
    const fields = validateForm(input.form, input.isPlaceholder, input.fail);
    if (!fields) return;
    const patch = buildResourcePatch(input, fields);
    try {
      if (saveResource(input, patch)) input.onClose();
    } catch (e) {
      input.fail(null, resolveErrorMessage(e));
    }
  };
}

type ResourceFieldsProps = {
  form: FormState;
  isPlaceholder: boolean;
  disciplinesEnabled: boolean;
  disciplines: Discipline[];
  projectOptions: Option[];
  errorField: string | null;
  errorId: string;
};

function ResourceFields(props: ResourceFieldsProps) {
  const { form, isPlaceholder, disciplinesEnabled, disciplines, projectOptions, errorField, errorId } = props;
  const disciplineOptions = disciplines.map((discipline) => ({ value: discipline.id, label: discipline.name }));
  return (
    <FieldGroup className="gap-3">
      <TextField
        label={isPlaceholder ? m.form_resource_name_optional_label() : m.form_resource_name_label()}
        value={form.name}
        onChange={form.setName}
        required={!isPlaceholder}
        invalid={errorField === "name"}
        describedById={errorId}
        layout="label-control"
      />
      <TextField
        label={m.form_resource_role_label()}
        value={form.role}
        onChange={form.setRole}
        placeholder={m.form_resource_role_placeholder()}
        invalid={errorField === "role"}
        describedById={errorId}
        layout="label-control"
      />
      {disciplinesEnabled && disciplines.length > 0 && (
        <SelectField
          label={m.form_resource_discipline_label()}
          value={form.disciplineId}
          onChange={form.setDisciplineId}
          options={disciplineOptions}
          placeholder={m.form_resource_discipline_none_placeholder()}
          layout="label-control"
        />
      )}
      {!isPlaceholder && (
        <SelectField
          label={m.form_resource_engagement_label()}
          value={form.engagement}
          onChange={(value) => form.setEngagement(value as ResourceEngagement)}
          options={buildResourceEngagementOptions()}
          layout="label-control"
        />
      )}
      {isPlaceholder && (
        <SelectField
          label={m.form_resource_bound_project_label()}
          value={form.projectId}
          onChange={form.setProjectId}
          options={projectOptions}
          placeholder={m.form_resource_select_project_placeholder()}
          required
          invalid={errorField === "projectId"}
          describedById={errorId}
          layout="label-control"
        />
      )}
    </FieldGroup>
  );
}

/** Add or edit a person or placeholder while preserving kind-specific capacity semantics. */
export function ResourceForm({ resource, kind: kindProp, onClose }: ResourceFormProps) {
  const add = useStore((state) => state.addResource);
  const update = useStore((state) => state.updateResource);
  const data = useActiveScopedData();
  const raw = useScopedData();
  const kind = resource?.kind ?? kindProp ?? "person";
  const isPlaceholder = kind === "placeholder";
  const form = useResourceFormState(resource);
  const { error, errorField, errorId, fail } = useFieldError();
  const disciplinesEnabled = useStore((state) => hasDisciplinesEnabled(state.data, state.activeAccountId));
  const projectOptions = useProjectOptions({
    resource,
    projects: data.projects,
    clients: data.clients,
    rawProjects: raw.projects,
    rawClients: raw.clients,
  });
  const submit = createSubmit({ resource, kind, isPlaceholder, form, fail, onClose, add, update });
  return (
    <Modal
      title={getFormTitle(resource, isPlaceholder)}
      onClose={onClose}
      onSubmit={submit}
      footer={<FormActions onCancel={onClose} />}
    >
      <ResourceFields
        form={form}
        isPlaceholder={isPlaceholder}
        disciplinesEnabled={disciplinesEnabled}
        disciplines={data.disciplines}
        projectOptions={projectOptions}
        errorField={errorField}
        errorId={errorId}
      />
      {!isPlaceholder && (
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
      )}
      <FieldError id={errorId}>{error}</FieldError>
      <RequiredLegend />
    </Modal>
  );
}
