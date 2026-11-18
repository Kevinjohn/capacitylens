import { useFormLifetimeClose } from '@/hooks/useFormLifetimeClose';
import { useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import { useActiveScopedData, useScopedData } from '@/store/useScopedData';
import { useEditSubmit } from '@/hooks/useEditSubmit';
import type { EntitySave } from '@/hooks/useEditSubmit';
import { useFieldError } from '@/hooks/useFieldError';
import { resolveDomainErrorMessage } from '@/lib/errorMessage';
import { validatePresetColor, parseName } from '@/lib/validation';
import { validateProjectClient } from '@capacitylens/shared/lib/integrity';
import { DEFAULT_COLORS } from '@/lib/palette';
import { byName } from '@/lib/displayOrder';
import { m } from '@/i18n';
import {
  ColorField,
  FormActions,
  Modal,
  RequiredLegend,
  SelectField,
  TextField,
} from '@/components/common/ui';
import type { Option } from '@/components/common/ui';
import { PrivateNameFields } from '@/components/common/PrivateNameFields';
import { usePrivateNameFields } from '@/components/common/usePrivateNameFields';
import { FieldError } from '@/components/ui/field';
import type { Project } from '@capacitylens/shared/types/entities';

/** Add (no `project`) or edit a project: name, required client, preset colour. `onClose` fires on
 * save or cancel. */
export function ProjectForm({
  project,
  onClose: close,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const onClose = useFormLifetimeClose(close);
  const add = useStore((state) => state.addProject);
  const update = useStore((state) => state.updateProject);
  const data = useActiveScopedData();
  const clients = data.clients;
  // Keep the raw scoped slice for the archived-parent label when the server returns an archived
  // parent alongside a child that still references it.
  const rawClients = useScopedData().clients;

  const [name, setName] = useState(project?.name ?? '');
  const [clientId, setClientId] = useState(project?.clientId ?? '');
  const [color, setColor] = useState(project?.color ?? DEFAULT_COLORS.project);
  const { error, errorField, errorId, fail } = useFieldError();
  const privateNameFields = usePrivateNameFields(project, fail);
  const allProjects = useStore((state) => state.data.projects);
  const { pending, submit } = useEditSubmit({
    editing: project,
    rows: allProjects,
    staleMessage: m.form_project_err_changed,
    fail,
    onSaved: onClose,
  });
  const selectedClientIsInternal =
    clients.find((client) => client.id === clientId)?.builtin === true;
  // Internal projects always read as neutral grey, so their colour is not editable.
  const showColourPicker = !selectedClientIsInternal;

  // Memoise client ordering because keystrokes do not change the client list. Append the current archived-client option outside that memo so its label resolves using the active locale.
  const baseClientOptions: Option[] = useMemo(() => {
    const internalClient = clients.find((client) => client.builtin === true);
    const ordinaryClients = clients.filter((client) => client.builtin !== true).sort(byName);
    return [
      ...(internalClient ? [{ value: internalClient.id, label: internalClient.name }] : []),
      ...ordinaryClients.map((client, index) => ({
        value: client.id,
        label: client.name,
        separatorBefore: internalClient !== undefined && index === 0,
      })),
    ];
  }, [clients]);
  // Retain a disabled selected option for the existing archived client so unrelated project edits round-trip its unchanged ID.
  const clientOptions = resolveProjectClientOptions({
    baseOptions: baseClientOptions,
    clients,
    rawClients,
    project,
  });
  const prepareSave = () =>
    prepareProjectSave({ project, name, clientId, color, privateNameFields, fail, add, update });

  return (
    <Modal
      title={project ? m.form_project_edit_title() : m.form_project_add_title()}
      onClose={onClose}
      onSubmit={() => {
        void submit(prepareSave);
      }}
      footer={<FormActions onCancel={onClose} disabled={pending} />}
    >
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        <ProjectFormFields
          name={name}
          setName={setName}
          protectedName={privateNameFields.protectedName}
          errorField={errorField}
          errorId={errorId}
          privateNameFields={privateNameFields}
          clientId={clientId}
          setClientId={setClientId}
          clientOptions={clientOptions}
          showColourPicker={showColourPicker}
          color={color}
          setColor={setColor}
          error={error}
          disabled={pending}
        />
      </fieldset>
    </Modal>
  );
}

function resolveProjectClientOptions({
  baseOptions,
  clients,
  rawClients,
  project,
}: {
  baseOptions: Option[];
  clients: ReturnType<typeof useActiveScopedData>['clients'];
  rawClients: ReturnType<typeof useScopedData>['clients'];
  project: Project | undefined;
}): Option[] {
  if (!project || clients.some((client) => client.id === project.clientId)) return baseOptions;
  const raw = rawClients.find((client) => client.id === project.clientId);
  return [
    ...baseOptions,
    {
      value: project.clientId,
      label: raw ? m.list_label_archived({ name: raw.name }) : m.form_option_current_archived(),
      disabled: true,
    },
  ];
}

function prepareProjectSave({
  project,
  name,
  clientId,
  color,
  privateNameFields,
  fail,
  add,
  update,
}: {
  project: Project | undefined;
  name: string;
  clientId: string;
  color: string;
  privateNameFields: ReturnType<typeof usePrivateNameFields>;
  fail: ReturnType<typeof useFieldError>['fail'];
  add: ReturnType<typeof useStore.getState>['addProject'];
  update: ReturnType<typeof useStore.getState>['updateProject'];
}): EntitySave | null {
  const trimmed = parseName(name, fail);
  if (!trimmed) return null;
  const privacy = privateNameFields.parsePrivacyPatch();
  if (!privacy) return null;
  const check = validateProjectClient(clientId);
  if (!check.ok) {
    const code = check.codes[0];
    if (!code) throw new Error('Project validation failed without an error code.');
    fail('client', resolveDomainErrorMessage(code));
    return null;
  }
  if (!validatePresetColor(color, fail)) return null;
  if (project) {
    return () =>
      update(project.id, { name: trimmed, clientId, color, ...privacy }, project.updatedAt);
  }
  return () =>
    add({
      name: trimmed,
      clientId,
      color,
      ...(privacy.isPrivate && privacy.codeName
        ? { isPrivate: privacy.isPrivate, codeName: privacy.codeName }
        : {}),
    });
}

function ProjectFormFields({
  name,
  setName,
  protectedName,
  errorField,
  errorId,
  privateNameFields,
  clientId,
  setClientId,
  clientOptions,
  showColourPicker,
  color,
  setColor,
  error,
  disabled,
}: {
  name: string;
  setName: (value: string) => void;
  protectedName: boolean;
  errorField: string | null;
  errorId: string;
  privateNameFields: ReturnType<typeof usePrivateNameFields>;
  clientId: string;
  setClientId: (value: string) => void;
  clientOptions: Option[];
  showColourPicker: boolean;
  color: string;
  setColor: (value: string) => void;
  error: string | null;
  disabled: boolean;
}) {
  return (
    <>
      <ProjectNameFields
        name={name}
        setName={setName}
        protectedName={protectedName}
        errorField={errorField}
        errorId={errorId}
        privateNameFields={privateNameFields}
        disabled={disabled}
      />
      <ProjectClientField
        clientId={clientId}
        setClientId={setClientId}
        clientOptions={clientOptions}
        errorField={errorField}
        errorId={errorId}
        disabled={disabled}
      />
      <ProjectFormDetails
        showColourPicker={showColourPicker}
        color={color}
        setColor={setColor}
        errorField={errorField}
        errorId={errorId}
        error={error}
        disabled={disabled}
      />
    </>
  );
}

function ProjectClientField({
  clientId,
  setClientId,
  clientOptions,
  errorField,
  errorId,
  disabled,
}: {
  clientId: string;
  setClientId: (value: string) => void;
  clientOptions: Option[];
  errorField: string | null;
  errorId: string;
  disabled: boolean;
}) {
  return (
    <SelectField
      label={m.form_project_client_label()}
      value={clientId}
      onChange={setClientId}
      options={clientOptions}
      placeholder={m.form_project_select_client_placeholder()}
      required
      invalid={errorField === 'client'}
      describedById={errorId}
      layout="label-control"
      disabled={disabled}
    />
  );
}

function ProjectNameFields({
  name,
  setName,
  protectedName,
  errorField,
  errorId,
  privateNameFields,
  disabled,
}: {
  name: string;
  setName: (value: string) => void;
  protectedName: boolean;
  errorField: string | null;
  errorId: string;
  privateNameFields: ReturnType<typeof usePrivateNameFields>;
  disabled: boolean;
}) {
  return (
    <>
      <TextField
        label={m.form_project_name_label()}
        value={name}
        onChange={setName}
        autoFocus={!protectedName}
        required
        disabled={disabled || protectedName}
        invalid={errorField === 'name'}
        describedById={errorId}
        layout="label-control"
      />
      <PrivateNameFields
        fields={privateNameFields}
        errorField={errorField}
        errorId={errorId}
        layout="label-control"
        disabled={disabled}
      />
    </>
  );
}

function ProjectFormDetails({
  showColourPicker,
  color,
  setColor,
  errorField,
  errorId,
  error,
  disabled,
}: {
  showColourPicker: boolean;
  color: string;
  setColor: (value: string) => void;
  errorField: string | null;
  errorId: string;
  error: string | null;
  disabled: boolean;
}) {
  return (
    <>
      {showColourPicker && (
        <ColorField
          label={m.form_project_colour_label()}
          value={color}
          onChange={setColor}
          invalid={errorField === 'color'}
          describedById={errorId}
          layout="label-control"
          disabled={disabled}
        />
      )}
      <FieldError id={errorId}>{error}</FieldError>
      <RequiredLegend />
    </>
  );
}
