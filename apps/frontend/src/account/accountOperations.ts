import {
  isAccountCommandId,
  isAccountIdempotencyKey,
} from '@capacitylens/shared/account/validation';

/** Identifies one browser-issued account operation and its idempotency key. */
export interface BrowserAccountOperation {
  commandId: string;
  idempotencyKey: string;
}

/** Creates unique identifiers for an account operation. */
export function createBrowserAccountOperation(): BrowserAccountOperation {
  return {
    commandId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  };
}

const OPERATION_STORAGE_PREFIX = 'capacitylens.account-operation.';
const OPERATION_IDENTITY_STORAGE_KEY = `${OPERATION_STORAGE_PREFIX}identity`;
// sessionStorage can be unavailable in hardened/private browser contexts. Keep the current page's
// retry ceremony in memory as the minimum safe fallback; successful storage still extends it across
// reloads for the lifetime of the tab.
const memoryOperations = new Map<string, BrowserAccountOperation>();
let activeOperationIdentity: string | undefined;
interface OperationCohort {
  inFlight: number;
  unknown: boolean;
  generation: number;
}

/** Identifies a operation cohort generation for balanced completion tracking. */
export interface OperationCohortHandle {
  key: string;
  generation: number;
}

const operationCohorts = new Map<string, OperationCohort>();
let operationCohortGeneration = 0;

function buildOperationStorageKey(operationKey: string): string {
  // Cleanup is best-effort because sessionStorage can fail partway through an identity change.
  // Keep the identity in the lookup coordinate as the backstop: a surviving old handle can only
  // ever be recovered by the same authenticated user.
  return `${OPERATION_STORAGE_PREFIX}${activeOperationIdentity ?? 'unbound'}.${operationKey}`;
}

function invalidateOperationCohorts(): void {
  operationCohortGeneration += 1;
  operationCohorts.clear();
}

/** Starts or joins the in-flight cohort for an operation key. */
export function beginOperationCohort(operationKey: string): OperationCohortHandle {
  const key = buildOperationStorageKey(operationKey);
  const existing = operationCohorts.get(key);
  if (existing) {
    existing.inFlight += 1;
    return { key, generation: existing.generation };
  }
  const cohort = { inFlight: 1, unknown: false, generation: operationCohortGeneration };
  operationCohorts.set(key, cohort);
  return { key, generation: cohort.generation };
}

/** Marks the current cohort as having an ambiguous operation outcome. */
export function markOperationCohortUnknown(handle: OperationCohortHandle): void {
  const cohort = operationCohorts.get(handle.key);
  if (cohort?.generation === handle.generation) cohort.unknown = true;
}

// The generation check rejects a stale sibling's completion: sign-out bumps the generation and
// clears every cohort, so a handle from before sign-out must not decrement or clear a same-key
// cohort a re-bound identity created afterward.
/** Releases one cohort reference if the handle belongs to the current generation. */
export function finishOperationCohort(handle: OperationCohortHandle): void {
  const cohort = operationCohorts.get(handle.key);
  if (!cohort || cohort.generation !== handle.generation) return;
  cohort.inFlight -= 1;
  if (cohort.inFlight > 0) return;
  operationCohorts.delete(handle.key);
  if (!cohort.unknown) clearStoredOperationByKey(handle.key);
}

/** End every implicit account-operation ceremony owned by the identity leaving this browser tab.
 * sessionStorage survives a reload, so sign-out must explicitly remove these handles before a
 * different identity can use the same tab. Unrelated per-tab preferences remain intact. */
export function clearStoredAccountOperations(): void {
  invalidateOperationCohorts();
  memoryOperations.clear();
  activeOperationIdentity = undefined;
  let keys: string[];
  try {
    keys = Array.from({ length: sessionStorage.length }, (_unused, index) =>
      sessionStorage.key(index),
    ).filter((key): key is string => key?.startsWith(OPERATION_STORAGE_PREFIX) === true);
  } catch (error) {
    // Log storage inspection failure so sign-out cleanup is diagnosable while sign-out itself can continue.
    console.error('Account operation storage could not be inspected during sign-out', error);
    return;
  }
  for (const key of keys) {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      // Log failed removal and continue clearing other identity-bound operation handles.
      console.error('An account operation could not be cleared during sign-out', error);
    }
  }
}

/** Bind implicit retry ceremonies to the authenticated user verified by `/api/auth/me`.
 * A same-user reload keeps its unknown-outcome recovery handle. A missing owner or a
 * different user clears every bearer before the authenticated application is rendered. */
export function bindStoredAccountOperationsToIdentity(identity: string): void {
  let storedIdentity: string | null = null;
  try {
    storedIdentity = sessionStorage.getItem(OPERATION_IDENTITY_STORAGE_KEY);
  } catch {
    // The in-memory identity below still protects identity changes during this page lifetime.
  }
  const previousIdentity = activeOperationIdentity ?? storedIdentity ?? undefined;
  if (previousIdentity !== identity) clearStoredAccountOperations();
  activeOperationIdentity = identity;
  try {
    sessionStorage.setItem(OPERATION_IDENTITY_STORAGE_KEY, identity);
  } catch {
    // Hardened browser contexts retain only the page-lifetime identity and operation maps.
  }
}

/** Reuses or creates the operation identity stored for an operation key. */
export function readOrCreateStoredOperation(operationKey: string): BrowserAccountOperation {
  const storageKey = buildOperationStorageKey(operationKey);
  const memoryOperation = memoryOperations.get(storageKey);
  if (memoryOperation) return memoryOperation;
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(storageKey) ?? 'null',
    ) as Partial<BrowserAccountOperation> | null;
    if (
      parsed &&
      isAccountCommandId(parsed.commandId) &&
      isAccountIdempotencyKey(parsed.idempotencyKey)
    ) {
      const operation = {
        commandId: parsed.commandId,
        idempotencyKey: parsed.idempotencyKey,
      };
      memoryOperations.set(storageKey, operation);
      return operation;
    }
  } catch {
    // A corrupt browser cache is not authoritative; replace it with a fresh opaque operation.
  }
  const created = createBrowserAccountOperation();
  memoryOperations.set(storageKey, created);
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(created));
  } catch {
    // The module-level fallback retains this implicit ceremony until a terminal outcome.
  }
  return created;
}

function clearStoredOperationByKey(storageKey: string): void {
  memoryOperations.delete(storageKey);
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // A completed server operation is authoritative even when browser storage cleanup is blocked.
  }
}
