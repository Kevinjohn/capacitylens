import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../store/useStore";
import { hasDisciplinesEnabled } from "../../store/selectors";
import { useActiveScopedData, useScopedData } from "../../store/useScopedData";
import { useFieldError } from "../../hooks/useFieldError";
import { flushPendingWrites } from "../../data/persist";
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
import { useResourceFormState, type ResourceFormState } from "./useResourceFormState";
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
type ResourceDraft = {
  name: string;
  role: string;
  disciplineId: string;
  engagement: ResourceEngagement;
  workingDays: Weekday[];
  halfDays: Weekday[];
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
  pendingCreatedResourceRef: { current: Resource | undefined };
  mountedRef: { current: boolean };
  submittingRef: { current: boolean };
  readActiveAccountId: () => string | null;
  setSubmitting: (submitting: boolean) => void;
};

type ValidatedFields = { name: string; role: string };

type ParseFormFieldsInput = {
  name: string;
  role: string;
  projectId: string;
  workingDays: Weekday[];
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
  projectId: string;
  fields: ValidatedFields;
};

function buildResourcePatch(input: BuildResourcePatchInput) {
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
    : { ...basePatch, kind, workingDays: input.workingDays, halfDays: input.halfDays };
}

type ResourcePatch = ReturnType<typeof buildResourcePatch>;

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
    return undefined;
  }
  return add({
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
}

function createSubmit(input: SubmitInput) {
  return () => {
    if (input.submittingRef.current) return;
    const pending = input.pendingCreatedResourceRef.current;
    const retryResource = pending && input.readResources().some(({ id }) => id === pending.id) ? pending : undefined;
    const resource = input.resource ?? retryResource;
    const fields = parseFormFields({
      name: input.draft.name,
      role: input.draft.role,
      projectId: input.draft.projectId,
      workingDays: input.draft.workingDays,
      isPlaceholder: input.isPlaceholder,
      fail: input.fail,
    });
    if (!fields) return;
    const patch = buildResourcePatch({
      resource,
      kind: input.kind,
      isPlaceholder: input.isPlaceholder,
      disciplineId: input.draft.disciplineId,
      engagement: input.draft.engagement,
      workingDays: input.draft.workingDays,
      halfDays: input.draft.halfDays,
      projectId: input.draft.projectId,
      fields,
    });
    const submittedAccountId = input.readActiveAccountId();
    try {
      if (!validateResourceFreshness(resource, input.readResources(), input.fail)) return;
      input.submittingRef.current = true;
      input.setSubmitting(true);
      const saved = saveResource({ resource, patch, add: input.add, update: input.update });
      if (!resource && saved && input.readResources().some(({ id }) => id === saved.id)) {
        input.pendingCreatedResourceRef.current = saved;
      }
      void flushPendingWrites()
        .then((result) => {
          if (!input.mountedRef.current || input.readActiveAccountId() !== submittedAccountId) return;
          if (result.kind === "clean") {
            input.pendingCreatedResourceRef.current = undefined;
            input.onClose();
            return;
          }
          input.fail(null, result.kind === "failed" ? resolveErrorMessage(result.error) : m.app_persist_error());
        })
        .catch((error: unknown) => {
          if (input.mountedRef.current) input.fail(null, resolveErrorMessage(error));
        })
        .finally(() => {
          input.submittingRef.current = false;
          if (input.mountedRef.current) input.setSubmitting(false);
        });
    } catch (e) {
      input.submittingRef.current = false;
      input.setSubmitting(false);
      input.fail(null, resolveErrorMessage(e));
    }
  };
}

function useResourceSubmit(
  input: Omit<SubmitInput, "pendingCreatedResourceRef" | "mountedRef" | "submittingRef" | "setSubmitting">,
) {
  const [submitting, setSubmitting] = useState(false);
  const pendingCreatedResourceRef = useRef<Resource | undefined>(undefined);
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  const submit = () =>
    createSubmit({
      ...input,
      pendingCreatedResourceRef,
      mountedRef,
      submittingRef,
      setSubmitting,
    })();
  return { submit, submitting };
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

type ResourceCapacityFieldsState = Pick<
  ResourceFormState,
  "workingDays" | "setWorkingDays" | "halfDays" | "setHalfDays"
>;

type ResourceCapacityFieldsProps = {
  form: ResourceCapacityFieldsState;
  isPlaceholder: boolean;
  error: string | null;
  errorField: string | null;
  errorId: string;
};

function ResourceCapacityFields({ form, isPlaceholder, error, errorField, errorId }: ResourceCapacityFieldsProps) {
  return (
    <>
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
    </>
  );
}

type ResourceFormContentProps = {
  form: ResourceFieldsState & ResourceCapacityFieldsState;
  isPlaceholder: boolean;
  disciplinesEnabled: boolean;
  disciplines: Discipline[];
  projectOptions: Option[];
  error: string | null;
  errorField: string | null;
  errorId: string;
};

function ResourceFormContent({
  form,
  isPlaceholder,
  disciplinesEnabled,
  disciplines,
  projectOptions,
  error,
  errorField,
  errorId,
}: ResourceFormContentProps) {
  return (
    <>
      <ResourceFields
        form={form}
        isPlaceholder={isPlaceholder}
        disciplinesEnabled={disciplinesEnabled}
        disciplines={disciplines}
        projectOptions={projectOptions}
        errorField={errorField}
        errorId={errorId}
      />
      <ResourceCapacityFields
        form={form}
        isPlaceholder={isPlaceholder}
        error={error}
        errorField={errorField}
        errorId={errorId}
      />
    </>
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
  const draft: ResourceDraft = {
    name: form.name,
    role: form.role,
    disciplineId: form.disciplineId,
    engagement: form.engagement,
    workingDays: form.workingDays,
    halfDays: form.halfDays,
    projectId: form.projectId,
  };
  const readResources = () => useStore.getState().data.resources;
  const { submit, submitting } = useResourceSubmit({
    resource,
    kind,
    isPlaceholder,
    draft,
    readResources,
    fail,
    onClose,
    add,
    update,
    readActiveAccountId: () => useStore.getState().activeAccountId,
  });
  return (
    <Modal
      title={resolveFormTitle(resource, isPlaceholder)}
      onClose={onClose}
      onSubmit={submit}
      footer={<FormActions onCancel={onClose} disabled={submitting} />}
    >
      <ResourceFormContent
        form={form}
        isPlaceholder={isPlaceholder}
        disciplinesEnabled={disciplinesEnabled}
        disciplines={data.disciplines}
        projectOptions={projectOptions}
        error={error}
        errorField={errorField}
        errorId={errorId}
      />
    </Modal>
  );
}
