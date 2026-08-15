import { useMemo, useState } from "react";
import { useStore } from "../../store/useStore";
import { useActiveScopedData, useScopedData } from "../../store/useScopedData";
import { useFieldError } from "../../hooks/useFieldError";
import { domainErrorMessage, errorMessage } from "../../lib/errorMessage";
import { validateHex, validateName } from "../../lib/validation";
import { isStaleEdit } from "../../lib/staleEdit";
import { validateProjectClient } from "@capacitylens/shared/lib/integrity";
import { DEFAULT_COLORS } from "../../lib/palette";
import { byName } from "../../lib/displayOrder";
import { internalColourModeFor } from "../../store/selectors";
import { m } from "@/i18n";
import { ColorField, FormActions, Modal, RequiredLegend, SelectField, TextField, type Option } from "../common/ui";
import { PrivateNameFields } from "../common/PrivateNameFields";
import { usePrivateNameFields } from "../common/usePrivateNameFields";
import { FieldError } from "../ui/field";
import type { Project } from "@capacitylens/shared/types/entities";

/** Add (no `project`) or edit a project: name, REQUIRED client, preset colour. `onClose` fires on
 *  save or cancel. */
export function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const add = useStore((s) => s.addProject);
  const update = useStore((s) => s.updateProject);
  const data = useActiveScopedData();
  const clients = data.clients;
  // The RAW scoped slice, for the archived-parent label only (see clientOptions below): in the demo
  // build an archived client is still in the raw slice (so we can show its name); in server mode the
  // per-account read strips it entirely, so the label degrades to the generic "(current, archived)".
  const rawClients = useScopedData().clients;
  const internalColourMode = useStore((s) => internalColourModeFor(s.data, s.activeAccountId));

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
  let clientOptions: Option[] = baseClientOptions;
  if (project && !clients.some((c) => c.id === project.clientId)) {
    const raw = rawClients.find((c) => c.id === project.clientId);
    clientOptions = [
      ...baseClientOptions,
      {
        value: project.clientId,
        label: raw ? m.list_label_archived({ name: raw.name }) : m.form_option_current_archived(),
        disabled: true,
      },
    ];
  }

  const submit = () => {
    const trimmed = validateName(name, fail);
    if (!trimmed) return;
    const privacy = privateNameFields.validatePrivacy();
    if (!privacy) return;
    const check = validateProjectClient(clientId);
    if (!check.ok) {
      fail("client", domainErrorMessage(check.codes[0]));
      return;
    }
    if (!validateHex(color, fail)) return;
    // Surface a store-side rejection (e.g. a clientId that isn't in this company) as a form error
    // instead of an uncaught React error — see the store CRUD contract.
    try {
      if (project) {
        if (isStaleEdit(useStore.getState().data.projects, project.id, project.updatedAt)) {
          fail(null, m.form_project_err_changed());
          return;
        }
        update(project.id, { name: trimmed, clientId, color, ...privacy });
      } else {
        add({ name: trimmed, clientId, color, ...privacy });
      }
      onClose();
    } catch (e) {
      fail(null, errorMessage(e));
    }
  };

  return (
    <Modal
      title={project ? m.form_project_edit_title() : m.form_project_add_title()}
      onClose={onClose}
      onSubmit={submit}
      footer={<FormActions onCancel={onClose} />}
    >
      <TextField
        label={m.form_project_name_label()}
        value={name}
        onChange={setName}
        autoFocus={!privateNameFields.protectedName}
        required
        disabled={privateNameFields.protectedName}
        invalid={errorField === "name"}
        describedById={errorId}
        layout="label-control"
      />
      <PrivateNameFields fields={privateNameFields} errorField={errorField} errorId={errorId} layout="label-control" />
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
    </Modal>
  );
}
