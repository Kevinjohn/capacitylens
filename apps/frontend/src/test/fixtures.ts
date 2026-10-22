import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import type {
  Account,
  Activity,
  Allocation,
  AppData,
  Client,
  Closure,
  ID,
  Project,
  Resource,
  TimeOff,
  Weekday,
} from "@capacitylens/shared/types/entities";
import type { Draft } from "@/store/useStore";
import { useStore } from "@/store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { createPlanningCacheState } from "@/data/planning/planningCacheController";
import type { BarLayout } from "@/components/scheduler/schedulerModel";

// Shared fixtures establish an active account so scoped store mutations have a valid tenant.

/** Mon–Fri, typed as Weekday[] so call sites don't need the `as Weekday[]` cast. */
export const WORKDAYS: Weekday[] = [1, 2, 3, 4, 5];

/** The account every fixture/entity is filed under unless overridden. */
export const DEFAULT_ACCOUNT_ID = "acct-test";

const TS = "2026-05-01T00:00:00.000Z";

/** A complete Account; override any field per test. */
export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    ...NULLABLE_FIELDS.accounts,
    id: DEFAULT_ACCOUNT_ID,
    createdAt: TS,
    updatedAt: TS,
    name: "Test Co",
    color: "#2d75da",
    workingDays: [...WORKDAYS],
    ...overrides,
  };
}

/** Empty AppData that already contains the default test account. */
export function makeAppData(overrides: Partial<AppData> = {}): AppData {
  return { ...emptyAppData(), accounts: [makeAccount()], ...overrides };
}

/** A valid person Draft<Resource>; override any field per test. */
export function makeResourceDraft(overrides: Partial<Draft<Resource>> = {}): Draft<Resource> {
  return {
    kind: "person",
    name: "Test Person",
    role: "Designer",
    employmentType: "permanent",
    engagement: "studio" as const,
    workingHoursPerDay: 8,
    workingDays: WORKDAYS,
    color: "#2d75da",
    isFavourite: false,
    ...overrides,
    halfDays: overrides.halfDays ?? [],
  };
}

/** A complete person Resource, the stored counterpart of {@link makeResourceDraft}, for specs that
 * build AppData directly instead of going through `addResource`. Override any field per test. */
export function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    ...NULLABLE_FIELDS.resources,
    id: "r1",
    accountId: "a1",
    createdAt: "t",
    updatedAt: "t",
    kind: "person",
    name: "Test Person",
    role: "Designer",
    employmentType: "permanent",
    engagement: "studio",
    workingHoursPerDay: 8,
    workingDays: WORKDAYS,
    halfDays: [],
    color: "#2d75da",
    ...overrides,
  };
}

/** A complete Client; override any field per test. */
export function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    ...NULLABLE_FIELDS.clients,
    id: "c1",
    accountId: "a1",
    createdAt: "t",
    updatedAt: "t",
    name: "Ferris",
    color: "#222",
    ...overrides,
  };
}

/** A complete Project; override any field per test. */
export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    ...NULLABLE_FIELDS.projects,
    id: "p1",
    accountId: "a1",
    createdAt: "t",
    updatedAt: "t",
    name: "Lightning",
    clientId: "c1",
    color: "#ec4899",
    ...overrides,
  };
}

/** A complete project-kind Activity; override any field per test. */
export function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    ...NULLABLE_FIELDS.activities,
    id: "t1",
    accountId: "a1",
    createdAt: "t",
    updatedAt: "t",
    name: "Wireframes",
    kind: "project",
    projectId: "p1",
    ...overrides,
  };
}

/** A complete confirmed Allocation; override any field per test. */
export function makeAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    ...NULLABLE_FIELDS.allocations,
    id: "a1",
    accountId: "a1",
    createdAt: "t",
    updatedAt: "t",
    resourceId: "r1",
    activityId: "t1",
    startDate: "2026-06-01",
    endDate: "2026-06-02",
    hoursPerDay: 8,
    status: "confirmed",
    ...overrides,
  };
}

/** A complete holiday TimeOff record; override any field per test. */
export function makeTimeOff(overrides: Partial<TimeOff> = {}): TimeOff {
  return {
    ...NULLABLE_FIELDS.timeOff,
    id: "to1",
    accountId: "a1",
    createdAt: "t",
    updatedAt: "t",
    resourceId: "r1",
    startDate: "2026-06-01",
    endDate: "2026-06-02",
    type: "holiday",
    ...overrides,
  };
}

/** A complete company Closure; override any field per test. */
export function makeClosure(overrides: Partial<Closure> = {}): Closure {
  return {
    id: "closure1",
    accountId: "a1",
    createdAt: "t",
    updatedAt: "t",
    name: "Christmas shutdown",
    startDate: "2026-12-24",
    endDate: "2026-12-27",
    ...overrides,
  };
}

/** A positioned {@link BarLayout}, the scheduler model's per-allocation render bar. Wraps
 * {@link makeAllocation} for its nested `allocation`; override any field (including nested
 * `allocation` fields via a full replacement) per test. */
export function makeBar(overrides: Partial<BarLayout> = {}): BarLayout {
  return {
    allocation: makeAllocation(),
    x: 0,
    width: 100,
    top: 0,
    color: "#2d75da",
    label: "Wireframes",
    external: false,
    ...overrides,
  };
}

/** Reset the store to a clean single-account state with that account active.
 * Use in beforeEach so `add*` (which requires an active account) works. The returned promise
 * settles once the planning cache has read the account, so allocation writes can begin. */
export function resetStoreWithAccount(accountId: ID = DEFAULT_ACCOUNT_ID): Promise<boolean> {
  const data = makeAppData({ accounts: [makeAccount({ id: accountId })] });
  useStore.getState().replaceAll(data);
  useStore.setState({ planning: createPlanningCacheState().planning });
  useStore.getState().setActiveAccount(accountId);
  // Visible rows alone do not reset the volatile transport’s pending Restore groups and commitments.
  useStore.getState().replaceAfterDemoImport(data);
  // Clear transient notices so the singleton store cannot leak another test’s toast.
  useStore.getState().setNotice(null);
  // Clear transient announcements and membership state so singleton fixtures remain order-independent.
  useStore.setState({ srAnnouncement: null, membershipRevision: 0 });
  // Likewise reset the transient access role so a prior viewer-guard test can't leave the
  // singleton store in 'viewer' and silently no-op the next spec's mutations. Default = editable.
  useStore.getState().setActiveRole(null);
  return useStore.getState().refreshPlanning();
}

type SetPlaceholdersEnabledOptions = { on: boolean; accountId?: ID };
/** Set the test account placeholder setting. */
export async function setPlaceholdersEnabled({
  on,
  accountId = DEFAULT_ACCOUNT_ID,
}: SetPlaceholdersEnabledOptions): Promise<void> {
  await useStore.getState().updateAccount(accountId, { placeholdersEnabled: on });
}

type SetExternalEnabledOptions = { on: boolean; accountId?: ID };
/** Set the test account external resource setting. */
export async function setExternalEnabled({
  on,
  accountId = DEFAULT_ACCOUNT_ID,
}: SetExternalEnabledOptions): Promise<void> {
  await useStore.getState().updateAccount(accountId, { externalEnabled: on });
}

/** Creates a fresh JSON Response for one mocked request. Bodies are single-use, so
 * mocks must create another response per invocation.
 * @param body JSON-serializable payload.
 * @param status HTTP status, defaulting to 200; bodyless statuses require a null-body Response instead.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Establish an indexed-fixture precondition without weakening the assertion that consumes it. */
export function requireValue<T>(value: T | undefined, context = "fixture value"): T {
  if (value === undefined) throw new Error(`Expected ${context}`);
  return value;
}
