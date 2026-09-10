import { useEffect, useRef, useState } from "react";
import { flushPendingWrites } from "../../data/persist";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { isStaleEdit } from "../../lib/isStaleEdit";
import { DEFAULT_COLORS } from "../../lib/palette";
import { validateText, validateWorkingDays } from "../../lib/validation";
import type { StoreState } from "../../store/types";
import { m } from "@/i18n";
import {
  FULL_DAY_HOURS,
  placeholderCapacityDefaults,
  type Resource,
  type ResourceEngagement,
  type ResourceKind,
  type Weekday,
} from "@capacitylens/shared/types/entities";

/** Editable values submitted by the person or placeholder form. */
export type ResourceSubmitDraft = {
  name: string;
  role: string;
  disciplineId: string;
  engagement: ResourceEngagement;
  workingDays: Weekday[];
  halfDays: Weekday[];
  projectId: string;
};

type Fail = (field: string | null, message: string) => void;
type AddResource = StoreState["addResource"];
type UpdateResource = StoreState["updateResource"];
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
  pendingResourceRef: { current: Resource | undefined };
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
  isPlaceholder: boolean;
  fail: Fail;
}): ValidatedFields | null {
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

function buildResourcePatch(input: {
  resource: Resource | undefined;
  kind: ResourceKind;
  isPlaceholder: boolean;
  disciplineId: string;
  engagement: ResourceEngagement;
  workingDays: Weekday[];
  halfDays: Weekday[];
  projectId: string;
  fields: ValidatedFields;
}) {
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

function validateResourceFreshness(resource: Resource | undefined, resources: Resource[], fail: Fail): boolean {
  if (!resource) return true;
  if (!isStaleEdit(resources, resource.id, resource.updatedAt)) return true;
  fail(null, m.form_resource_err_changed());
  return false;
}

function saveResource(input: {
  resource: Resource | undefined;
  patch: ResourcePatch;
  add: AddResource;
  update: UpdateResource;
}) {
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

function refreshPendingResource(input: SubmitInput, resource: Resource | undefined, saved: Resource | undefined) {
  const pendingId = resource?.id ?? saved?.id;
  const latest = pendingId && input.readResources().find(({ id }) => id === pendingId);
  if (latest) input.pendingResourceRef.current = latest;
}

type FlushResult = Awaited<ReturnType<typeof flushPendingWrites>>;

function handleResourceFlushResult(input: SubmitInput, result: FlushResult, submittedAccountId: string | null) {
  if (!input.mountedRef.current || input.readActiveAccountId() !== submittedAccountId) return;
  if (result.kind === "clean") {
    input.pendingResourceRef.current = undefined;
    input.onClose();
    return;
  }
  input.fail(null, result.kind === "failed" ? resolveErrorMessage(result.error) : m.app_persist_error());
}

function handleResourceFlushError(input: SubmitInput, error: unknown, submittedAccountId: string | null) {
  if (input.mountedRef.current && input.readActiveAccountId() === submittedAccountId) {
    input.fail(null, resolveErrorMessage(error));
  }
}

function finishResourceSubmit(input: SubmitInput) {
  input.submittingRef.current = false;
  if (input.mountedRef.current) input.setSubmitting(false);
}

function createSubmit(input: SubmitInput) {
  return () => {
    if (input.submittingRef.current) return;
    const pending = input.pendingResourceRef.current;
    const retryResource = pending && input.readResources().some(({ id }) => id === pending.id) ? pending : undefined;
    const resource = retryResource ?? input.resource;
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
      const saved = saveResource({ resource, patch, add: input.add, update: input.update });
      refreshPendingResource(input, resource, saved);
      void flushPendingWrites()
        .then((result) => handleResourceFlushResult(input, result, submittedAccountId))
        .catch((error: unknown) => handleResourceFlushError(input, error, submittedAccountId))
        .finally(() => finishResourceSubmit(input));
    } catch (e) {
      input.submittingRef.current = false;
      input.setSubmitting(false);
      input.fail(null, resolveErrorMessage(e));
    }
  };
}

/** Save a resource and keep its draft available until persistence acknowledges the write. */
export function useResourceSubmit(input: SubmitInputBase) {
  const [submitting, setSubmitting] = useState(false);
  const pendingResourceRef = useRef<Resource | undefined>(undefined);
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
      pendingResourceRef,
      mountedRef,
      submittingRef,
      setSubmitting,
    })();
  return { submit, submitting };
}
