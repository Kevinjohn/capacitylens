import type { Account, AppData, ID, Resource, Weekday } from '../types/entities'
import type { Draft } from '../store/useStore'
import { useStore } from '../store/useStore'
import { emptyAppData } from '../types/entities'

// Shared test fixtures. Centralises the Mon–Fri working-week and resource-draft
// factory, plus the multi-tenancy helpers: a default account, a `makeAccount`
// factory, a `makeAppData` that always includes that account, and a one-line
// store reset that seeds the account AND makes it active (so `add*`, which now
// requires an active account, works in unit tests).

/** Mon–Fri, typed as Weekday[] so call sites don't need the `as Weekday[]` cast. */
export const WORKDAYS: Weekday[] = [1, 2, 3, 4, 5]

/** The account every fixture/entity is filed under unless overridden. */
export const DEFAULT_ACCOUNT_ID = 'acct-test'

const TS = '2026-05-01T00:00:00.000Z'

/** A complete Account; override any field per test. */
export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: DEFAULT_ACCOUNT_ID,
    createdAt: TS,
    updatedAt: TS,
    name: 'Test Co',
    color: '#6366f1',
    ...overrides,
  }
}

/** Empty AppData that already contains the default test account. */
export function makeAppData(overrides: Partial<AppData> = {}): AppData {
  return { ...emptyAppData(), accounts: [makeAccount()], ...overrides }
}

/** A valid person Draft<Resource>; override any field per test. */
export function makeResourceDraft(overrides: Partial<Draft<Resource>> = {}): Draft<Resource> {
  return {
    kind: 'person',
    name: 'Test Person',
    role: 'Designer',
    employmentType: 'permanent',
    workingHoursPerDay: 8,
    workingDays: WORKDAYS,
    color: '#6366f1',
    ...overrides,
  }
}

/** Reset the store to a clean single-account state with that account active.
 *  Use in beforeEach so `add*` (which requires an active account) works. */
export function resetStoreWithAccount(accountId: ID = DEFAULT_ACCOUNT_ID): void {
  useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount({ id: accountId })] }))
  useStore.getState().setActiveAccount(accountId)
}
