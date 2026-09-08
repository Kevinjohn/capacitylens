import { useMemo, useState } from "react";
import { useStore } from "../../store/useStore";
import { useActiveScopedData, useScopedData } from "../../store/useScopedData";
import { useFieldError } from "../../hooks/useFieldError";
import { resolveDomainErrorMessage, resolveErrorMessage } from "../../lib/errorMessage";
import { validateHex, validateName } from "../../lib/validation";
import { isStaleEdit } from "../../lib/isStaleEdit";
import { validateProjectClient } from "@capacitylens/shared/lib/integrity";
import { DEFAULT_COLORS } from "../../lib/palette";
import { byName } from "../../lib/displayOrder";
import { resolveInternalColourMode } from "../../store/selectors";
import { m } from "@/i18n";
import { ColorField, FormActions, Modal, RequiredLegend, SelectField, TextField, type Option } from "../common/ui";
import { PrivateNameFields } from "../common/PrivateNameFields";
import { usePrivateNameFields } from "../common/usePrivateNameFields";
import { FieldError } from "../ui/field";
import type { Project } from "@capacitylens/shared/types/entities";

type ProjectPrivacy = NonNullable<ReturnType<ReturnType<typeof usePrivateNameFields>["validatePrivacy"]>>;

/** Add (no `project`) or edit a project: name, REQUIRED client, preset colour. `onClose` fires on
 *  save or cancel. */
export function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const add = useStore((state) => state.addProject);
  const update = useStore((state) => state.updateProject);
  const data = useActiveScopedData();
  const clients = data.clients;
  // The RAW scoped slice, for the archived-parent label only (see clientOptions below): in the demo
  // build an archived client is still in the raw slice (so we can show its name); in server mode the
  // per-account read strips it entirely, so the label degrades to the generic "(current, archived)".
  const rawClients = useScopedData().clients;
  const internalColourMode = useStore((state) => resolveInternalColourMode(state.data, state.activeAccountId));

  const [name, setName] = useState(project?.name ?? "");
  const [clientId, setClientId] = useState(project?.clientId ?? "");
  const [color, setColor] = useState(project?.color ?? DEFAULT_COLORS.project);
  const { error, errorField, errorId, fail } = useFieldError();
  const privateNameFields = usePrivateNameFields(project, fail);
  const selectedClientIsInternal = clients.find((client) => client.id === clientId)?.builtin === true;
  const showColourPicker = internalColourMode === "palette" || !selectedClientIsInternal;

  // The internal/ordinary split + sort is the only non-trivial cost here; memoised on its actual
  // input (clients) so it isn't redone on every keystroke elsewhere in the form. The archived-option
  // append below stays OUTSIDE the memo: its label goes through `m.*()`, which must keep resolving
  // fresh every render (a stale locale/account switch is otherwise possible — see validation.ts's
  // "getter, not module-scope const" note), so it's rebuilt un-cached each render.
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
  // Editing a project whose client is ARCHIVED: the active-only options above don't contain it, so
  // without this the select would silently blank and an unrelated edit (rename, colour) couldn't
  // round-trip the unchanged clientId. Append the current id as a DISABLED option — it stays
  // selected/submittable as the current value (the store's unchanged-parent relaxation accepts it),
  // but can't be picked back once the user chooses an active client.
  const clientOptions = resolveProjectClientOptions({ baseOptions: baseClientOptions, clients, rawClients, project });
  const submit = useProjectSubmit({ project, name, clientId, color, privateNameFields, fail, add, update, onClose });

  return (
    <Modal
      title={project ? m.form_project_edit_title() : m.form_project_add_title()}
      onClose={onClose}
      onSubmit={submit}
      footer={<FormActions onCancel={onClose} />}
    >
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
      />
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
  clients: ReturnType<typeof useActiveScopedData>["clients"];
  rawClients: ReturnType<typeof useScopedData>["clients"];
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

function useProjectSubmit({
  project,
  name,
  clientId,
  color,
  privateNameFields,
  fail,
  add,
  update,
  onClose,
}: {
  project: Project | undefined;
  name: string;
  clientId: string;
  color: string;
  privateNameFields: ReturnType<typeof usePrivateNameFields>;
  fail: ReturnType<typeof useFieldError>["fail"];
  add: ReturnType<typeof useStore.getState>["addProject"];
  update: ReturnType<typeof useStore.getState>["updateProject"];
  onClose: () => void;
}) {
  return () => {
    const trimmed = validateName(name, fail);
    if (!trimmed) return;
    const privacy = privateNameFields.validatePrivacy();
    if (!privacy) return;
    const check = validateProjectClient(clientId);
    if (!check.ok) {
      const code = check.codes[0];
      if (!code) throw new Error("Project validation failed without an error code.");
      fail("client", resolveDomainErrorMessage(code));
      return;
    }
    if (!validateHex(color, fail)) return;
    try {
      if (project && isStaleEdit(useStore.getState().data.projects, project.id, project.updatedAt)) {
        fail(null, m.form_project_err_changed());
        return;
      }
      saveProject({ project, trimmed, clientId, color, privacy, add, update });
      onClose();
    } catch (error) {
      fail(null, resolveErrorMessage(error));
    }
  };
}

function saveProject({
  project,
  trimmed,
  clientId,
  color,
  privacy,
  add,
  update,
}: {
  project: Project | undefined;
  trimmed: string;
  clientId: string;
  color: string;
  privacy: ProjectPrivacy;
  add: ReturnType<typeof useStore.getState>["addProject"];
  update: ReturnType<typeof useStore.getState>["updateProject"];
}) {
  if (project) {
    update(project.id, { name: trimmed, clientId, color, ...privacy });
    return;
  }
  add({
    name: trimmed,
    clientId,
    color,
    ...(privacy.isPrivate && privacy.codeName ? { isPrivate: privacy.isPrivate, codeName: privacy.codeName } : {}),
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
      />
      <ProjectClientField
        clientId={clientId}
        setClientId={setClientId}
        clientOptions={clientOptions}
        errorField={errorField}
        errorId={errorId}
      />
      <ProjectFormDetails
        showColourPicker={showColourPicker}
        color={color}
        setColor={setColor}
        errorField={errorField}
        errorId={errorId}
        error={error}
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
}: {
  clientId: string;
  setClientId: (value: string) => void;
  clientOptions: Option[];
  errorField: string | null;
  errorId: string;
}) {
  return (
    <SelectField
      label={m.form_project_client_label()}
      value={clientId}
      onChange={setClientId}
      options={clientOptions}
      placeholder={m.form_project_select_client_placeholder()}
      required
      invalid={errorField === "client"}
      describedById={errorId}
      layout="label-control"
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
}: {
  name: string;
  setName: (value: string) => void;
  protectedName: boolean;
  errorField: string | null;
  errorId: string;
  privateNameFields: ReturnType<typeof usePrivateNameFields>;
}) {
  return (
    <>
      <TextField
        label={m.form_project_name_label()}
        value={name}
        onChange={setName}
        autoFocus={!protectedName}
        required
        disabled={protectedName}
        invalid={errorField === "name"}
        describedById={errorId}
        layout="label-control"
      />
      <PrivateNameFields fields={privateNameFields} errorField={errorField} errorId={errorId} layout="label-control" />
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
}: {
  showColourPicker: boolean;
  color: string;
  setColor: (value: string) => void;
  errorField: string | null;
  errorId: string;
  error: string | null;
}) {
  return (
    <>
      {showColourPicker && (
        <ColorField
          label={m.form_project_colour_label()}
          value={color}
          onChange={setColor}
          invalid={errorField === "color"}
          describedById={errorId}
          layout="label-control"
        />
      )}
      <FieldError id={errorId}>{error}</FieldError>
      <RequiredLegend />
    </>
  );
}
