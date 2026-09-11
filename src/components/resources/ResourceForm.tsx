import { useMemo } from "react";
import { useStore } from "../../store/useStore";
import { hasDisciplinesEnabled } from "../../store/selectors";
import { useActiveScopedData, useScopedData } from "../../store/useScopedData";
import { useFieldError } from "../../hooks/useFieldError";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { validateText, validateWorkingDays } from "../../lib/validation";
import { isStaleEdit } from "../../lib/isStaleEdit";
import { m } from "@/i18n";
import { FormActions, Modal, RequiredLegend, SelectField, TextField, type Option } from "../common/ui";
import { FieldError, FieldGroup } from "../ui/field";
import { buildResourceEngagementOptions } from "../../lib/metadata";
import { DEFAULT_COLORS } from "../../lib/palette";
import { useResourceFormState, type ResourceFormState } from "./useResourceFormState";
import { ResourceAvailabilityFields } from "./ResourceAvailabilityFields";
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

const optionalValue = (value: string): string | undefined => (value === "" ? undefined : value);

type ResourceFormProps = { resource?: Resource; kind?: ResourceKind; onClose: () => void };
type ResourceDraft = {
  name: string;
  role: string;
  disciplineId: string;
  engagement: ResourceEngagement;
  workingDays: Weekday[];
  halfDays: Weekday[];
  firstAvailableDate: string;
  lastAvailableDate: string;
  projectId: string;
};
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

function resolveFormTitle(resource: Resource | undefined, isPlaceholder: boolean) {
  if (resource) return isPlaceholder ? m.form_resource_edit_placeholder_title() : m.form_resource_edit_resource_title();
  return isPlaceholder ? m.form_resource_add_placeholder_title() : m.form_resource_add_resource_title();
}

type Fail = ReturnType<typeof useFieldError>["fail"];
type AddResource = ReturnType<typeof useStore.getState>["addResource"];
type UpdateResource = ReturnType<typeof useStore.getState>["updateResource"];
type SubmitInput = {
  resource: Resource | undefined;
  kind: ResourceKind;
  isPlaceholder: boolean;
  draft: ResourceDraft;
  readResources: () => Resource[];
  fail: Fail;
  onClose: () => void;
  add: AddResource;
  update: UpdateResource;
};

type ValidatedFields = { name: string; role: string };

type ParseFormFieldsInput = {
  name: string;
  role: string;
  projectId: string;
  workingDays: Weekday[];
  firstAvailableDate: string;
  lastAvailableDate: string;
  isPlaceholder: boolean;
  fail: Fail;
};

function parseFormFields(input: ParseFormFieldsInput): ValidatedFields | null {
  const { name: rawName, role: rawRole, projectId, workingDays, isPlaceholder, fail } = input;
  const name = validateText(rawName, fail, {
    field: "name",
    required: !isPlaceholder,
    requiredMessage: m.form_resource_err_name_required(),
  });
  if (name === null) return null;
  const role = validateText(rawRole, fail, { field: "role", required: false });
  if (role === null) return null;
  if (isPlaceholder && !projectId) {
    fail("projectId", m.form_resource_err_placeholder_project());
    return null;
  }
  if (!isPlaceholder && !validateWorkingDays(workingDays, fail)) return null;
  if (
    !isPlaceholder &&
    input.firstAvailableDate &&
    input.lastAvailableDate &&
    input.firstAvailableDate > input.lastAvailableDate
  ) {
    fail("lastAvailableDate", m.form_resource_err_availability_dates_order());
    return null;
  }
  return { name, role };
}

type BuildResourcePatchInput = {
  resource: Resource | undefined;
  kind: ResourceKind;
  isPlaceholder: boolean;
  disciplineId: string;
  engagement: ResourceEngagement;
  workingDays: Weekday[];
  halfDays: Weekday[];
  firstAvailableDate: string;
  lastAvailableDate: string;
  projectId: string;
  fields: ValidatedFields;
};

type ResourcePatch = Pick<
  Resource,
  "kind" | "role" | "employmentType" | "engagement" | "workingHoursPerDay" | "workingDays" | "halfDays" | "color"
> & {
  name: string | undefined;
  disciplineId: string | undefined;
  projectId: string | undefined;
  firstAvailableDate?: string | undefined;
  lastAvailableDate?: string | undefined;
};

function buildResourcePatch(input: BuildResourcePatchInput): ResourcePatch {
  const { resource, kind, isPlaceholder, fields } = input;
  const basePatch = {
    name: fields.name || undefined,
    role: fields.role,
    disciplineId: input.disciplineId || undefined,
    employmentType: isPlaceholder ? ("permanent" as const) : (resource?.employmentType ?? "permanent"),
    engagement: isPlaceholder ? ("studio" as const) : input.engagement,
    workingHoursPerDay: FULL_DAY_HOURS,
    projectId: isPlaceholder ? input.projectId : undefined,
    color: resource?.color ?? DEFAULT_COLORS.resource,
  };
  return isPlaceholder
    ? { ...basePatch, kind: "placeholder" as const, ...placeholderCapacityDefaults() }
    : {
        ...basePatch,
        kind,
        workingDays: input.workingDays,
        halfDays: input.halfDays,
        firstAvailableDate: optionalValue(input.firstAvailableDate),
        lastAvailableDate: optionalValue(input.lastAvailableDate),
      };
}

type SaveResourceInput = {
  resource: Resource | undefined;
  patch: ResourcePatch;
  add: AddResource;
  update: UpdateResource;
};

function validateResourceFreshness(resource: Resource | undefined, resources: Resource[], fail: Fail): boolean {
  if (!resource) return true;
  if (!isStaleEdit(resources, resource.id, resource.updatedAt)) return true;
  fail(null, m.form_resource_err_changed());
  return false;
}

function saveResource(input: SaveResourceInput) {
  const { resource, patch, add, update } = input;
  if (resource) {
    update(resource.id, patch);
    return;
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
    ...(patch.firstAvailableDate ? { firstAvailableDate: patch.firstAvailableDate } : {}),
    ...(patch.lastAvailableDate ? { lastAvailableDate: patch.lastAvailableDate } : {}),
  });
}

function createSubmit(input: SubmitInput) {
  return () => {
    const fields = parseFormFields({
      name: input.draft.name,
      role: input.draft.role,
      projectId: input.draft.projectId,
      workingDays: input.draft.workingDays,
      firstAvailableDate: input.draft.firstAvailableDate,
      lastAvailableDate: input.draft.lastAvailableDate,
      isPlaceholder: input.isPlaceholder,
      fail: input.fail,
    });
    if (!fields) return;
    const patch = buildResourcePatch({
      resource: input.resource,
      kind: input.kind,
      isPlaceholder: input.isPlaceholder,
      disciplineId: input.draft.disciplineId,
      engagement: input.draft.engagement,
      workingDays: input.draft.workingDays,
      halfDays: input.draft.halfDays,
      firstAvailableDate: input.draft.firstAvailableDate,
      lastAvailableDate: input.draft.lastAvailableDate,
      projectId: input.draft.projectId,
      fields,
    });
    try {
      if (!validateResourceFreshness(input.resource, input.readResources(), input.fail)) return;
      saveResource({ resource: input.resource, patch, add: input.add, update: input.update });
      input.onClose();
    } catch (e) {
      input.fail(null, resolveErrorMessage(e));
    }
  };
}

type ResourceFieldsState = Pick<ResourceFormState, "name" | "setName" | "role" | "setRole"> &
  Pick<ResourceFormState, "disciplineId" | "setDisciplineId" | "engagement" | "setEngagement"> &
  Pick<ResourceFormState, "projectId" | "setProjectId">;

type ResourceFieldsProps = {
  form: ResourceFieldsState;
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
  const isPerson = kind === "person";
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
  const draft: ResourceDraft = {
    name: form.name,
    role: form.role,
    disciplineId: form.disciplineId,
    engagement: form.engagement,
    workingDays: form.workingDays,
    halfDays: form.halfDays,
    firstAvailableDate: form.firstAvailableDate,
    lastAvailableDate: form.lastAvailableDate,
    projectId: form.projectId,
  };
  const readResources = () => useStore.getState().data.resources;
  const submit = createSubmit({ resource, kind, isPlaceholder, draft, readResources, fail, onClose, add, update });
  return (
    <Modal
      title={resolveFormTitle(resource, isPlaceholder)}
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
      {isPerson && <ResourceAvailabilityFields form={form} errorField={errorField} errorId={errorId} />}
      <FieldError id={errorId}>{error}</FieldError>
      <RequiredLegend />
    </Modal>
  );
}
