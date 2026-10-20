import { useEffect, useRef, useState } from "react";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { isStaleEdit } from "@/lib/isStaleEdit";
import { DEFAULT_COLORS } from "@/lib/palette";
import { parseText, validateWorkingDays } from "@/lib/validation";
import type { usePlanningActions } from "@/data/planning/usePlanningActions";
import { m } from "@/i18n";
import { FULL_DAY_HOURS, placeholderCapacityDefaults } from "@capacitylens/shared/types/entities";
import type { Resource, ResourceEngagement, ResourceKind, Weekday } from "@capacitylens/shared/types/entities";

/** Editable values submitted by the person or placeholder form. */
export type ResourceSubmitDraft = {
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

const optionalValue = (value: string): string | undefined => (value === "" ? undefined : value);

type Fail = (field: string | null, message: string) => void;
type AddResource = ReturnType<typeof usePlanningActions>["addResource"];
type UpdateResource = ReturnType<typeof usePlanningActions>["updateResource"];
type SubmitInputBase = {
  resource: Resource | undefined;
  kind: ResourceKind;
  isPlaceholder: boolean;
  draft: ResourceSubmitDraft;
  readResources: () => Resource[];
  fail: Fail;
  onClose: () => void;
  add: AddResource;
  update: UpdateResource;
  readActiveAccountId: () => string | null;
};
type SubmitInput = SubmitInputBase & {
  mountedRef: { current: boolean };
  submittingRef: { current: boolean };
  setSubmitting: (submitting: boolean) => void;
};

type ValidatedFields = { name: string; role: string };

function parseFormFields(input: {
  name: string;
  role: string;
  projectId: string;
  workingDays: Weekday[];
  firstAvailableDate: string;
  lastAvailableDate: string;
  isPlaceholder: boolean;
  fail: Fail;
}): ValidatedFields | null {
  const { name: rawName, role: rawRole, projectId, workingDays, isPlaceholder, fail } = input;
  const name = parseText(rawName, fail, {
    field: "name",
    required: !isPlaceholder,
    requiredMessage: m.form_resource_err_name_required(),
  });
  if (name === null) return null;
  const role = parseText(rawRole, fail, { field: "role", required: false });
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
    fail("lastAvailableDate", String(m.form_resource_err_availability_dates_order()));
    return null;
  }
  return { name, role };
}

type ResourcePatch = Pick<
  Resource,
  "kind" | "role" | "employmentType" | "engagement" | "workingHoursPerDay" | "workingDays" | "halfDays" | "color"
> & {
  name: string | undefined;
  disciplineId: string | undefined;
  projectId: string | undefined;
  avatarUrl: string | undefined;
  firstAvailableDate?: string | undefined;
  lastAvailableDate?: string | undefined;
};

// Resource kind and edit/create state intentionally converge at this one persistence boundary.

function buildResourcePatch(input: {
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
}): ResourcePatch {
  const { resource, kind, isPlaceholder, fields } = input;
  const basePatch = {
    name: fields.name || undefined,
    role: fields.role,
    avatarUrl: kind === "person" ? (resource?.avatarUrl ?? undefined) : undefined,
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

function validateResourceFreshness(resource: Resource | undefined, resources: Resource[], fail: Fail): boolean {
  if (!resource) return true;
  if (!isStaleEdit(resources, resource.id, resource.updatedAt)) return true;
  fail(null, m.form_resource_err_changed());
  return false;
}

async function saveResource(input: {
  resource: Resource | undefined;
  patch: ResourcePatch;
  add: AddResource;
  update: UpdateResource;
}) {
  const { resource, patch, add, update } = input;
  if (resource) {
    await update(resource.id, patch);
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
    ...(patch.avatarUrl ? { avatarUrl: patch.avatarUrl } : {}),
    ...(patch.disciplineId ? { disciplineId: patch.disciplineId } : {}),
    ...(patch.projectId ? { projectId: patch.projectId } : {}),
    ...(patch.firstAvailableDate ? { firstAvailableDate: patch.firstAvailableDate } : {}),
    ...(patch.lastAvailableDate ? { lastAvailableDate: patch.lastAvailableDate } : {}),
  });
}

function finishResourceSubmit(input: SubmitInput) {
  input.submittingRef.current = false;
  if (input.mountedRef.current) input.setSubmitting(false);
}

function createSubmit(input: SubmitInput) {
  return async () => {
    if (input.submittingRef.current) return;
    const resource = input.resource;
    const fields = parseFormFields({ ...input.draft, isPlaceholder: input.isPlaceholder, fail: input.fail });
    if (!fields) return;
    const patch = buildResourcePatch({
      ...input.draft,
      resource,
      kind: input.kind,
      isPlaceholder: input.isPlaceholder,
      fields,
    });
    const submittedAccountId = input.readActiveAccountId();
    try {
      if (!validateResourceFreshness(resource, input.readResources(), input.fail)) return;
      input.submittingRef.current = true;
      input.setSubmitting(true);
      const saved = await saveResource({ resource, patch, add: input.add, update: input.update });
      if (saved?.kind === "blocked") {
        return;
      }
      if (input.mountedRef.current && input.readActiveAccountId() === submittedAccountId) input.onClose();
    } catch (e) {
      if (input.mountedRef.current && input.readActiveAccountId() === submittedAccountId) {
        input.fail(null, resolveErrorMessage(e));
      }
    } finally {
      finishResourceSubmit(input);
    }
  };
}

/** Save a resource and keep its draft available until persistence acknowledges the write. */
export function useResourceSubmit(input: SubmitInputBase) {
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const submit = () =>
    createSubmit({
      ...input,
      mountedRef,
      submittingRef,
      setSubmitting,
    })();
  return { submit, submitting };
}
