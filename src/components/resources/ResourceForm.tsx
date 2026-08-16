import { useMemo, useState } from "react";
import { useStore } from "../../store/useStore";
import { disciplinesEnabledFor } from "../../store/selectors";
import { useActiveScopedData, useScopedData } from "../../store/useScopedData";
import { useFieldError } from "../../hooks/useFieldError";
import { errorMessage } from "../../lib/errorMessage";
import { validateText, validateWorkingDays } from "../../lib/validation";
import { isStaleEdit } from "../../lib/staleEdit";
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
import { resourceEngagementOptions } from "../../lib/metadata";
import { DEFAULT_COLORS } from "../../lib/palette";
import { weekdayLabel } from "../../lib/weekdays";
import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import {
  FULL_DAY_HOURS,
  placeholderCapacityDefaults,
  type Resource,
  type ResourceEngagement,
  type ResourceKind,
  type Weekday,
} from "@capacitylens/shared/types/entities";

/**
 * Add/edit a person or a placeholder. The richest validation path in the app.
 *
 * @param resource the resource to edit, or undefined to add a new one.
 * @param kind     the kind for a NEW resource ('person' | 'placeholder'); ignored when editing
 *   (an existing resource's own `kind` wins). The form opens LOCKED to one kind — people and
 *   placeholders have separate add buttons, so there's no in-modal type switcher.
 * @param onClose  called after a successful save, or on cancel.
 *
 * Non-obvious rules enforced here: a PERSON requires a name (a placeholder's is optional); a
 * PLACEHOLDER must be bound to a project; a person must select at least one working day (a
 * zero-capacity person reads as permanently over-allocated); placeholders display the company week
 * read-only; every form write uses the fixed 8-hour full-day capacity; hidden employment data is
 * preserved on person edits; placeholders force Studio engagement; and a resource's colour is
 * DERIVED from its discipline (no per-resource colour control — see DECISIONS).
 */
export function ResourceForm({
  resource,
  kind: kindProp,
  onClose,
}: {
  resource?: Resource;
  kind?: ResourceKind;
  onClose: () => void;
}) {
  const add = useStore((s) => s.addResource);
  const update = useStore((s) => s.updateResource);
  const account = useStore((s) => s.data.accounts.find((candidate) => candidate.id === s.activeAccountId));
  const data = useActiveScopedData();
  // When the account doesn't use disciplines, hide the picker. Any existing disciplineId
  // on an edited resource is left untouched (the field just isn't shown).
  const disciplinesEnabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId));
  const disciplines = data.disciplines;
  const projects = data.projects;
  const clients = data.clients;
  // The RAW scoped slice, for the archived bound-project label only (see projectOptions below): in
  // the demo build an archived project/client is still in the raw slice (so we can show its name);
  // in server mode the per-account read strips it entirely, so the label degrades to the generic
  // "(current, archived)".
  const raw = useScopedData();

  const kind = resource?.kind ?? kindProp ?? "person";
  const isPlaceholder = kind === "placeholder";
  const companyWorkingDays = useMemo(
    () => normalizeAccountWorkingDays(account?.workingDays, account?.weekStartsOn ?? 1),
    [account?.workingDays, account?.weekStartsOn],
  );
  const companyWorkingDayNames = companyWorkingDays.map(weekdayLabel).join(", ");
  const [name, setName] = useState(resource?.name ?? "");
  const [role, setRole] = useState(resource?.role ?? "");
  const [disciplineId, setDisciplineId] = useState(resource?.disciplineId ?? "");
  const [engagement, setEngagement] = useState<ResourceEngagement>(resource?.engagement ?? "studio");
  const [workingDays, setWorkingDays] = useState<Weekday[]>(resource?.workingDays ?? [1, 2, 3, 4, 5]);
  const [halfDays, setHalfDays] = useState<Weekday[]>(resource?.halfDays ?? []);
  const [projectId, setProjectId] = useState(resource?.projectId ?? "");
  const { error, errorField, errorId, fail } = useFieldError();

  const disciplineOptions: Option[] = disciplines.map((d) => ({ value: d.id, label: d.name }));
  // The projects×clients join is the only non-trivial cost here (O(n·m) — a `.find` per project);
  // memoised on its actual inputs so it isn't redone on every keystroke elsewhere in the form. The
  // archived-option append below stays OUTSIDE the memo: its label goes through `m.*()`, which must
  // keep resolving fresh every render (a stale locale/account switch is otherwise possible — see
  // validation.ts's "getter, not module-scope const" note), so it's rebuilt un-cached each render.
  const baseProjectOptions: Option[] = useMemo(
    () =>
      projects.map((p) => {
        const client = clients.find((c) => c.id === p.clientId);
        return { value: p.id, label: client ? `${client.name} / ${p.name}` : p.name };
      }),
    [projects, clients],
  );
  // Editing a placeholder whose bound project is ARCHIVED: the active-only options above don't
  // contain it, so without this the select would silently blank and an unrelated edit (role, hours)
  // couldn't round-trip the unchanged projectId. Append the current id as a DISABLED option — it
  // stays selected/submittable as the current value (the store's unchanged-parent relaxation
  // accepts it), but can't be picked back once the user chooses an active project. (Mirrors
  // ProjectForm's archived-client option.)
  let projectOptions: Option[] = baseProjectOptions;
  if (resource?.projectId && !projects.some((p) => p.id === resource.projectId)) {
    const rawProject = raw.projects.find((p) => p.id === resource.projectId);
    const rawClient = rawProject && raw.clients.find((c) => c.id === rawProject.clientId);
    projectOptions = [
      ...baseProjectOptions,
      {
        value: resource.projectId,
        label: rawProject
          ? m.list_label_archived({ name: rawClient ? `${rawClient.name} / ${rawProject.name}` : rawProject.name })
          : m.form_option_current_archived(),
        disabled: true,
      },
    ];
  }

  const submit = () => {
    // A person needs a name; a placeholder's is optional. Either way, reject emoji/junk.
    const cleanName = validateText(name, fail, {
      field: "name",
      required: !isPlaceholder,
      requiredMessage: m.form_resource_err_name_required(),
    });
    if (cleanName === null) return;
    const cleanRole = validateText(role, fail, { field: "role", required: false });
    if (cleanRole === null) return;
    if (isPlaceholder && !projectId) {
      fail("projectId", m.form_resource_err_placeholder_project());
      return;
    }
    // Placeholders inherit the company calendar and persist only inert defaults. A person with zero
    // working days has zero capacity every day, so their personal selection remains validated.
    if (!isPlaceholder && !validateWorkingDays(workingDays, fail)) return;
    const patch = {
      kind,
      name: cleanName ? cleanName : undefined,
      role: cleanRole,
      disciplineId: disciplineId || undefined,
      // Employment remains compatibility data but is intentionally hidden. Preserve it on person
      // edits rather than silently resetting a freelancer/contractor; new people and placeholders
      // retain the existing permanent default.
      employmentType: isPlaceholder ? ("permanent" as const) : (resource?.employmentType ?? "permanent"),
      engagement: isPlaceholder ? ("studio" as const) : engagement,
      // The working-pattern picker is the form's only availability control: full / half / off maps
      // to 8 / 4 / 0 hours. Keep writing the compatibility field so legacy custom values normalise
      // when that specific resource is edited, without migrating untouched records in bulk.
      workingHoursPerDay: FULL_DAY_HOURS,
      workingDays,
      halfDays,
      ...(isPlaceholder ? placeholderCapacityDefaults() : {}),
      projectId: isPlaceholder ? projectId : undefined,
      // Resources no longer carry their own colour — the scheduler/list derive it
      // from the discipline. Keep a stable fallback so the entity stays valid.
      color: resource?.color ?? DEFAULT_COLORS.resource,
    };
    // Surface a store-side rejection (e.g. a dangling disciplineId/placeholder projectId, or the
    // empty-working-days backstop) as a form error rather than an uncaught React error — see the
    // store CRUD contract.
    try {
      if (resource) {
        if (isStaleEdit(useStore.getState().data.resources, resource.id, resource.updatedAt)) {
          fail(null, m.form_resource_err_changed());
          return;
        }
        update(resource.id, patch);
      } else add(patch);
      onClose();
    } catch (e) {
      fail(null, errorMessage(e));
    }
  };

  return (
    <Modal
      title={
        resource
          ? isPlaceholder
            ? m.form_resource_edit_placeholder_title()
            : m.form_resource_edit_resource_title()
          : isPlaceholder
            ? m.form_resource_add_placeholder_title()
            : m.form_resource_add_resource_title()
      }
      onClose={onClose}
      onSubmit={submit}
      footer={<FormActions onCancel={onClose} />}
    >
      <FieldGroup className="gap-3">
        <TextField
          label={isPlaceholder ? m.form_resource_name_optional_label() : m.form_resource_name_label()}
          value={name}
          onChange={setName}
          required={!isPlaceholder}
          invalid={errorField === "name"}
          describedById={errorId}
          layout="label-control"
        />
        <TextField
          label={m.form_resource_role_label()}
          value={role}
          onChange={setRole}
          placeholder={m.form_resource_role_placeholder()}
          invalid={errorField === "role"}
          describedById={errorId}
          layout="label-control"
        />
        {disciplinesEnabled && (
          <SelectField
            label={m.form_resource_discipline_label()}
            value={disciplineId}
            onChange={setDisciplineId}
            options={disciplineOptions}
            placeholder={m.form_resource_discipline_none_placeholder()}
            layout="label-control"
          />
        )}
        {!isPlaceholder && (
          <SelectField
            label={m.form_resource_engagement_label()}
            value={engagement}
            onChange={(v) => setEngagement(v as ResourceEngagement)}
            options={resourceEngagementOptions()}
            layout="label-control"
          />
        )}
        {isPlaceholder && (
          <SelectField
            label={m.form_resource_bound_project_label()}
            value={projectId}
            onChange={setProjectId}
            options={projectOptions}
            placeholder={m.form_resource_select_project_placeholder()}
            required
            invalid={errorField === "projectId"}
            describedById={errorId}
            layout="label-control"
          />
        )}
      </FieldGroup>
      {isPlaceholder ? (
        <div className="space-y-1.5">
          <div className="text-sm font-medium">{m.form_resource_working_days_label()}</div>
          <p className="text-sm text-muted-foreground">
            {m.form_resource_placeholder_working_days({ days: companyWorkingDayNames })}
          </p>
        </div>
      ) : (
        <WorkingDayPicker
          label={m.form_resource_working_days_label()}
          workingDays={workingDays}
          halfDays={halfDays}
          onChange={(nextWorkingDays, nextHalfDays) => {
            setWorkingDays(nextWorkingDays);
            setHalfDays(nextHalfDays);
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
