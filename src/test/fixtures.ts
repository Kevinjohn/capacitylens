import type {
  Account,
  Activity,
  Allocation,
  AppData,
  Client,
  ID,
  Project,
  Resource,
  TimeOff,
  Weekday,
} from "@capacitylens/shared/types/entities";
import type { Draft } from "../store/useStore";
import { useStore } from "../store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { BarLayout } from "../components/scheduler/schedulerModel";

// Shared test fixtures. Centralises the Mon–Fri working-week and resource-draft
// factory, plus the multi-tenancy helpers: a default account, a `makeAccount`
// factory, a `makeAppData` that always includes that account, and a one-line
// store reset that seeds the account AND makes it active (so `add*`, which now
// requires an active account, works in unit tests).

/** Mon–Fri, typed as Weekday[] so call sites don't need the `as Weekday[]` cast. */
export const WORKDAYS: Weekday[] = [1, 2, 3, 4, 5];

/** The account every fixture/entity is filed under unless overridden. */
export const DEFAULT_ACCOUNT_ID = "acct-test";

const TS = "2026-05-01T00:00:00.000Z";

/** A complete Account; override any field per test. */
export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
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

/** A complete person Resource — the stored counterpart of {@link makeResourceDraft}, for specs that
 *  build AppData directly instead of going through `addResource`. Override any field per test. */
export function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
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
    id: "c1",
    accountId: "a1",
    createdAt: "t",
    updatedAt: "t",
    name: "Acme",
    color: "#222",
    ...overrides,
  };
}

/** A complete Project; override any field per test. */
export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
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

/** A positioned {@link BarLayout} — the scheduler model's per-allocation render bar. Wraps
 *  {@link makeAllocation} for its nested `allocation`; override any field (including nested
 *  `allocation` fields via a full replacement) per test. */
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
 *  Use in beforeEach so `add*` (which requires an active account) works. */
export function resetStoreWithAccount(accountId: ID = DEFAULT_ACCOUNT_ID): void {
  useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount({ id: accountId })] }));
  useStore.getState().setActiveAccount(accountId);
  // replaceAll swaps only `data` — the singleton store's transient `notice` survives, so a prior
  // test's toast would leak into the next. Clear it here so every spec starts notice-free and
  // tests that assert on `notice` are order-independent (no per-test baseline needed).
  useStore.getState().setNotice(null);
  // Same for the transient a11y capacity announcement (WCAG 4.1.3): a prior keyboard-edit test
  // leaves an srAnnouncement on the singleton, so clear it here so specs asserting on it are
  // order-independent. There's no "clear" setter (announceCapacity only ever SETS), so null it directly.
  useStore.setState({ srAnnouncement: null, membershipRevision: 0 });
  // Likewise reset the transient access role (P1.12) so a prior viewer-guard test can't leave the
  // singleton store in 'viewer' and silently no-op the next spec's mutations. Default = editable.
  useStore.getState().setActiveRole(null);
}

/** Toggle the per-account "show placeholders" view pref in unit tests — mirrors the app's Settings
 *  toggle (updateAccount), replacing the retired device-global setter. Defaults to the active
 *  default test account. */
export function setPlaceholdersEnabled(on: boolean, accountId: ID = DEFAULT_ACCOUNT_ID): void {
  useStore.getState().updateAccount(accountId, { placeholdersEnabled: on });
}

/** Toggle the per-account "show external resources" view pref in unit tests (see
 *  setPlaceholdersEnabled). */
export function setExternalEnabled(on: boolean, accountId: ID = DEFAULT_ACCOUNT_ID): void {
  useStore.getState().updateAccount(accountId, { externalEnabled: on });
}
