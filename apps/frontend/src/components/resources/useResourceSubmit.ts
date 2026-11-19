import { useEffect, useRef } from 'react';
import { useEditSubmit } from '@/hooks/useEditSubmit';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { DEFAULT_COLORS } from '@/lib/palette';
import { parseText, validateWorkingDays } from '@/lib/validation';
import type { StoreState } from '@/store/types';
import { m } from '@/i18n';
import {
  FULL_DAY_HOURS,
  buildPlaceholderCapacityDefaults,
} from '@capacitylens/shared/types/entities';
import type {
  Resource,
  ResourceEngagement,
  ResourceKind,
  Weekday,
} from '@capacitylens/shared/types/entities';

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

const normalizeOptional = (value: string): string | undefined => (value === '' ? undefined : value);

type Fail = (field: string | null, message: string) => void;
type AddResource = StoreState['addResource'];
type UpdateResource = StoreState['updateResource'];
type SubmitInputBase = {
  resource: Resource | undefined;
  kind: ResourceKind;
  isPlaceholder: boolean;
  draft: ResourceSubmitDraft;
  resources: readonly Resource[];
  fail: Fail;
  onClose: () => void;
  add: AddResource;
  update: UpdateResource;
  readActiveCompanyId: () => string | null;
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
    field: 'name',
    required: !isPlaceholder,
    requiredMessage: m.form_resource_err_name_required(),
  });
  if (name === null) return null;
  const role = parseText(rawRole, fail, { field: 'role', required: false });
  if (role === null) return null;
  if (isPlaceholder && !projectId) {
    fail('projectId', m.form_resource_err_placeholder_project());
    return null;
  }
  if (!isPlaceholder && !validateWorkingDays(workingDays, fail)) return null;
  if (
    !isPlaceholder &&
    input.firstAvailableDate &&
    input.lastAvailableDate &&
    input.firstAvailableDate > input.lastAvailableDate
  ) {
    fail('lastAvailableDate', String(m.form_resource_err_availability_dates_order()));
    return null;
  }
  return { name, role };
}

type ResourcePatch = Pick<
  Resource,
  | 'kind'
  | 'role'
  | 'employmentType'
  | 'engagement'
  | 'workingHoursPerDay'
  | 'workingDays'
  | 'halfDays'
  | 'color'
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
    avatarUrl: kind === 'person' ? (resource?.avatarUrl ?? undefined) : undefined,
    disciplineId: input.disciplineId || undefined,
    employmentType: isPlaceholder
      ? ('permanent' as const)
      : (resource?.employmentType ?? 'permanent'),
    engagement: isPlaceholder ? ('studio' as const) : input.engagement,
    workingHoursPerDay: resource?.kind === 'person' ? resource.workingHoursPerDay : FULL_DAY_HOURS,
    projectId: isPlaceholder ? input.projectId : undefined,
    color: resource?.color ?? DEFAULT_COLORS.resource,
  };
  return isPlaceholder
    ? { ...basePatch, kind: 'placeholder' as const, ...buildPlaceholderCapacityDefaults() }
    : {
        ...basePatch,
        kind,
        workingDays: input.workingDays,
        halfDays: input.halfDays,
        firstAvailableDate: normalizeOptional(input.firstAvailableDate),
        lastAvailableDate: normalizeOptional(input.lastAvailableDate),
      };
}

async function saveResource(input: {
  resource: Resource | undefined;
  patch: ResourcePatch;
  add: AddResource;
  update: UpdateResource;
}) {
  const { resource, patch, add, update } = input;
  if (resource) {
    await update(resource.id, patch, resource.updatedAt);
    return undefined;
  }
  return await add({
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

function prepareResourceSave(input: SubmitInputBase) {
  const resource = input.resource;
  const fields = parseFormFields({
    ...input.draft,
    isPlaceholder: input.isPlaceholder,
    fail: input.fail,
  });
  if (!fields) return null;
  const patch = buildResourcePatch({
    ...input.draft,
    resource,
    kind: input.kind,
    isPlaceholder: input.isPlaceholder,
    fields,
  });
  return () => saveResource({ resource, patch, add: input.add, update: input.update });
}

/** Save a resource and keep its draft available until persistence acknowledges the write. */
export function useResourceSubmit(input: SubmitInputBase) {
  const mountedRef = useRef(true);
  const submittedCompanyId = useRef<string | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // A save that settles after the form closed or the company changed must not close or mark the
  // form now showing.
  const isCurrent = () =>
    mountedRef.current && input.readActiveCompanyId() === submittedCompanyId.current;
  const { pending, submit } = useEditSubmit({
    editing: input.resource,
    rows: input.resources,
    staleMessage: m.form_resource_err_changed,
    cancelledMessage: resolveErrorMessage,
    fail: (field, message) => {
      if (isCurrent()) input.fail(field, message);
    },
    onSaved: () => {
      if (isCurrent()) input.onClose();
    },
  });
  return {
    submit: () =>
      submit(() => {
        submittedCompanyId.current = input.readActiveCompanyId();
        return prepareResourceSave(input);
      }),
    submitting: pending,
  };
}
