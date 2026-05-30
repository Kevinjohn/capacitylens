# Multi-tenancy implementation plan

Decisions (from product owner):
- **Load UX**: full-screen account picker on *every* load (activeAccountId is never persisted).
- **Data model**: single shared store; every entity carries `accountId`; filter everywhere.
- **Migration**: fresh start — leave old `floaty/v1` localStorage untouched; orphan it.

## Real architecture (verified)
- React + Vite + Zustand SPA. Data = one `AppData` blob in localStorage key `floaty/v1`, loaded by `bootstrap()` in `src/main.tsx`.
- `src/types/entities.ts`: `interface Entity { id, createdAt, updatedAt }`; each domain entity `extends Entity`. `AppData` has 8 arrays. `SCHEMA_VERSION = 2`. `emptyAppData()`. `PersistedState { schemaVersion, data }`.
- `src/store/useStore.ts`: `Draft<T> = Omit<T,'id'|'createdAt'|'updatedAt'>`, `Patch<T> = Partial<Draft<T>>`. Helpers `mutate(producer)` (history), `stamp()` (returns `{createdAt,updatedAt}`), `newId()`, `updateById`. `add*` accept `Draft`, return the entity. `importData: (data) => mutate(() => data)`. Integrity asserts in store. Exports `Filters`, `emptyFilters`, `hasActiveFilters`.
- `src/store/selectors.ts`: pure helpers `allocationsForResource`, `resourcesByDiscipline(data)`, etc.
- `src/test/fixtures.ts`: only `WORKDAYS` + `makeResourceDraft(Draft<Resource>)`. No entity/AppData builders.
- UI kit `src/components/common/ui.tsx` exports: `Button` (spreads native attrs; variant primary|ghost|danger), `ColorSwatch`, `Modal({title,onClose,children,footer})`, `TextField({label,value,onChange,...})`, `ColorField`, `FieldError`, `EmptyState`, `ListPage({title,addLabel,onAdd,children})`, `ConfirmDialog({title,message,confirmLabel?,onConfirm,onCancel})`, `Avatar({name,color})`, `TemporaryTag`.
- `src/lib/palette.ts`: `DEFAULT_COLORS` (already has `.account: '#6366f1'`), `PALETTE: string[]`, `pickColor(seed)`.
- `src/lib/color.ts`: `isHexColor`, `readableTextColor`.

## Components reading store data (must become account-scoped)
Slice readers (`useStore((s) => s.data.X)`):
- clients/ClientList (clients), clients/ClientForm (clients)
- disciplines/DisciplineList (disciplines), disciplines/DisciplineForm (disciplines)
- projects/ProjectList (projects), projects/ProjectForm (projects, clients)
- resources/ResourceList (resources), resources/ResourceForm (resources, disciplines, projects)
- tasks/TaskList (tasks), tasks/TaskForm (tasks, projects, phases)
- timeoff/TimeOffList (timeOff, resources), timeoff/TimeOffForm (resources)

Whole-data readers (`useStore((s) => s.data)`):
- scheduler/SchedulerToolbar, scheduler/AllocationModal, scheduler/SchedulerGrid, ImportExport

## Changes
1. **entities.ts**: add `Account extends Entity { name; color }`; add `ScopedEntity extends Entity { accountId: ID }`; make the 8 domain entities `extends ScopedEntity`; add `accounts: Account[]` to `AppData` + `emptyAppData`; `SCHEMA_VERSION = 3`; add `ScopedEntityKey` union of the 8 array keys.
2. **useStore.ts**: redefine `Draft<T> = Omit<T,'id'|'accountId'|'createdAt'|'updatedAt'>`. Add `activeAccountId: ID|null` (init null). Add `addAccount(Draft<Account>) => Account`, `updateAccount`, `deleteAccount` (cascade-drop all entities with that accountId; if active → setActiveAccount(null)), `setActiveAccount(id|null)` (also reset past/future + ui.filters/collapsedGroups/selectedAllocationId). Add `const requireAccount = () => { const id = get().activeAccountId; if(!id) throw...; return id }`. In each `add*`, stamp `accountId: requireAccount()`. `importData`: re-stamp incoming scoped entities with active accountId, replace only that account's slice, keep other accounts.
3. **useScopedData.ts** (new): `useScopedData(): AppData` memoized on (data, activeAccountId); returns `scopeData(data, id)` or empty data. Add `scopeData(data, accountId)` to selectors.ts.
4. Replace the 16 reads: slice readers → `const clients = useScopedData().clients`; whole-data readers → `const data = useScopedData()`.
5. **AccountPicker.tsx** (new, `src/components/accounts/`): full-screen list of `accounts` (buttons → setActiveAccount); inline create (TextField name + PALETTE colour → addAccount then setActiveAccount); delete w/ ConfirmDialog.
6. **AppShell.tsx**: after `hydrated` gate, `if (!activeAccount) return <AccountPicker/>`. Sidebar shows active account name + "Switch company" (setActiveAccount(null)).
7. **seed.ts**: two demo companies, every entity tagged accountId.
8. **migrate.ts**: `normalize` add `accounts: asArray(data.accounts)`.
9. **main.tsx**: `new LocalStorageAdapter('floaty/v3')` (fresh start; orphan floaty/v1).
10. **ImportExport.tsx**: export scoped active-account data (accounts stripped); import stamps into active account via store.

## Test impact (the main risk)
`add*` now throws without an active account. Update store/CRUD tests' `reset()` to also set `activeAccountId` (e.g. seed one account + `useStore.setState({ activeAccountId: 'acct-1' })`), and add `accounts: [...]` to the reset `data`. Fixtures: add `DEFAULT_ACCOUNT_ID`, `makeAccount`, entity builders that stamp accountId, and `makeAppData` including an account. Add new tests: scopeData, account CRUD + cascade, picker gating, import-into-account.
