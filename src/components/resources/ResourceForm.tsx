import { useMemo } from "react";
import { useStore } from "../../store/useStore";
import { hasDisciplinesEnabled } from "../../store/selectors";
import { useActiveScopedData, useScopedData } from "../../store/useScopedData";
import { useFieldError } from "../../hooks/useFieldError";
import { m } from "@/i18n";
import { FormActions, Modal, RequiredLegend, SelectField, TextField, type Option } from "../common/ui";
import { FieldError, FieldGroup } from "../ui/field";
import { buildResourceEngagementOptions } from "../../lib/metadata";
import { useResourceFormState, type ResourceFormState } from "./useResourceFormState";
import { useResourceSubmit, type ResourceSubmitDraft } from "./useResourceSubmit";
import { ResourceAvailabilityFields } from "./ResourceAvailabilityFields";
import {
  type Client,
  type Discipline,
  type Project,
  type Resource,
  type ResourceEngagement,
  type ResourceKind,
} from "@capacitylens/shared/types/entities";

type ResourceFormProps = { resource?: Resource; kind?: ResourceKind; onClose: () => void };
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

type ResourceFieldsState = Pick<ResourceFormState, "name" | "setName" | "role" | "setRole"> &
  Pick<ResourceFormState, "disciplineId" | "setDisciplineId" | "engagement" | "setEngagement"> &
  Pick<ResourceFormState, "projectId" | "setProjectId">;

type ResourceFieldsProps = {
  form: ResourceFieldsState;
  isPlaceholder: boolean;
  disabled: boolean;
  disciplinesEnabled: boolean;
  disciplines: Discipline[];
  projectOptions: Option[];
  errorField: string | null;
  errorId: string;
};

function ResourceFields(props: ResourceFieldsProps) {
  const { form, isPlaceholder, disabled, disciplinesEnabled, disciplines, projectOptions, errorField, errorId } = props;
  const disciplineOptions = disciplines.map((discipline) => ({ value: discipline.id, label: discipline.name }));
  return (
    <fieldset disabled={disabled} className="min-w-0">
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
    </fieldset>
  );
}

type ResourceFormBodyProps = {
  form: ResourceFormState;
  isPlaceholder: boolean;
  isPerson: boolean;
  disabled: boolean;
  disciplinesEnabled: boolean;
  disciplines: Discipline[];
  projectOptions: Option[];
  error: string | null;
  errorField: string | null;
  errorId: string;
};

function ResourceFormBody({
  form,
  isPlaceholder,
  isPerson,
  disabled,
  disciplinesEnabled,
  disciplines,
  projectOptions,
  error,
  errorField,
  errorId,
}: ResourceFormBodyProps) {
  return (
    <>
      <ResourceFields
        form={form}
        isPlaceholder={isPlaceholder}
        disabled={disabled}
        disciplinesEnabled={disciplinesEnabled}
        disciplines={disciplines}
        projectOptions={projectOptions}
        errorField={errorField}
        errorId={errorId}
      />
      {isPerson && (
        <fieldset disabled={disabled} className="min-w-0">
          <ResourceAvailabilityFields form={form} errorField={errorField} errorId={errorId} />
        </fieldset>
      )}
      <FieldError id={errorId}>{error}</FieldError>
      <RequiredLegend />
    </>
  );
}

function buildResourceSubmitDraft(form: ResourceFormState): ResourceSubmitDraft {
  return {
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
  const draft = buildResourceSubmitDraft(form);
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
      <ResourceFormBody
        form={form}
        isPlaceholder={isPlaceholder}
        isPerson={isPerson}
        disabled={submitting}
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
