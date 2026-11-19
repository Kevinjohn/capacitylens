import type { StateCreator } from 'zustand';
import {
  readDefaultSidebarOpen,
  readStoredBarLabelPrefs,
  readStoredMinimiseWeekends,
  readStoredSidebarOpen,
  readStoredWeekSnapOverride,
  readStoredUtilisationPrefs,
  writeStoredBarLabelPrefs,
  writeStoredMinimiseWeekends,
  writeStoredSidebarOpen,
  writeStoredUtilisationPrefs,
} from '@/lib/displayPrefs';
import { applyThemeToDom, readStoredTheme, writeStoredTheme } from '@/lib/theme';
import type { StoreState } from '@/store/types';

type RuntimeSliceKeys =
  | 'hydrated'
  | 'planningAuthLossVersion'
  | 'activeCompanyLoadFailed'
  | 'notice'
  | 'srAnnouncement'
  | 'dirtyForm'
  | 'dirtyFormSources'
  | 'draggingAllocationId'
  | 'theme'
  | 'utilisationPrefs'
  | 'barLabelPrefs'
  | 'sidebarOpen'
  | 'minimiseWeekends'
  | 'weekSnapEnabled'
  | 'activeRole'
  | 'activeRoleStatus'
  | 'activePermissions'
  | 'membershipRevision'
  | 'masquerade'
  | 'setHydrated'
  | 'setNotice'
  | 'announceCapacity'
  | 'setDirtyForm'
  | 'setDirtyFormSource'
  | 'setDraggingAllocation'
  | 'setTheme'
  | 'setUtilisationPref'
  | 'setBarLabelPref'
  | 'setSidebarOpen'
  | 'setMinimiseWeekends'
  | 'setActiveRole'
  | 'invalidateMemberships'
  | 'setMasquerade';

type RuntimeSlice = Pick<StoreState, RuntimeSliceKeys>;

type PersistedFlagKey = 'sidebarOpen' | 'minimiseWeekends';

const defaultDirtyFormSource = Symbol('setDirtyForm');

const createPersistedFlagSetter = <K extends PersistedFlagKey>(
  set: Parameters<StateCreator<StoreState, [], [], RuntimeSlice>>[0],
  key: K,
  write: (value: boolean) => void,
) =>
  function setPersistedFlag(value: boolean): void {
    write(value);
    set({ [key]: value } as Pick<StoreState, K>);
  };

function readRuntimeInitialState() {
  return {
    hydrated: false,
    planningAuthLossVersion: 0,
    activeCompanyLoadFailed: null,
    notice: null,
    srAnnouncement: null,
    dirtyForm: false,
    dirtyFormSources: new Set<symbol>(),
    draggingAllocationId: null,
    theme: readStoredTheme(),
    utilisationPrefs: readStoredUtilisationPrefs(),
    barLabelPrefs: readStoredBarLabelPrefs(),
    sidebarOpen: readStoredSidebarOpen() ?? readDefaultSidebarOpen(),
    minimiseWeekends: readStoredMinimiseWeekends(),
    weekSnapEnabled: readStoredWeekSnapOverride(),
    activeRole: null,
    activeRoleStatus: 'not-applicable' as const,
    activePermissions: [],
    membershipRevision: 0,
    masquerade: { kind: 'inactive' as const },
  };
}

type ApplyDirtyFormSourceOptions = { state: StoreState; source: symbol; dirty: boolean };
function applyDirtyFormSource({ state, source, dirty }: ApplyDirtyFormSourceOptions) {
  const dirtyFormSources = new Set(state.dirtyFormSources);
  if (dirty) dirtyFormSources.add(source);
  else dirtyFormSources.delete(source);
  return { dirtyFormSources, dirtyForm: dirtyFormSources.size > 0 };
}

/** Device preferences and transient application/session state. */
export const createRuntimeSlice: StateCreator<StoreState, [], [], RuntimeSlice> = (set) => {
  // Share device-preference setter wiring so persistence and reactive publication stay paired.
  // Theme also repaints the document.
  return {
    ...readRuntimeInitialState(),

    setHydrated: (value) => set({ hydrated: value }),
    setNotice: (message, tone = 'info') => set({ notice: message ? { message, tone } : null }),
    announceCapacity: (text) =>
      set((state) => ({
        srAnnouncement: { text, seq: (state.srAnnouncement?.seq ?? 0) + 1 },
      })),
    // Retain the boolean API as one owned source. Component publishers use setDirtyFormSource so
    // clearing one contribution can never erase another still-dirty owner.
    setDirtyForm: (value) =>
      set((state) => applyDirtyFormSource({ state, source: defaultDirtyFormSource, dirty: value })),
    setDirtyFormSource: ({ source, dirty }) =>
      set((state) => applyDirtyFormSource({ state, source, dirty })),
    setDraggingAllocation: (id) => set({ draggingAllocationId: id }),
    setTheme: (preference) => {
      writeStoredTheme(preference);
      applyThemeToDom(preference);
      set({ theme: preference });
    },
    // The two pref maps stay written out: a shared factory over them needs a double cast to keep
    // the mapped key/value pair typed, which costs more clarity than the four lines it saves.
    setUtilisationPref: ({ key, value }) =>
      set((state) => {
        const next = { ...state.utilisationPrefs, [key]: value };
        writeStoredUtilisationPrefs(next);
        return { utilisationPrefs: next };
      }),
    setBarLabelPref: ({ key, value }) =>
      set((state) => {
        const next = { ...state.barLabelPrefs, [key]: value };
        writeStoredBarLabelPrefs(next);
        return { barLabelPrefs: next };
      }),
    setSidebarOpen: createPersistedFlagSetter(set, 'sidebarOpen', (open) =>
      writeStoredSidebarOpen(open),
    ),
    setMinimiseWeekends: createPersistedFlagSetter(
      set,
      'minimiseWeekends',
      writeStoredMinimiseWeekends,
    ),
    setActiveRole: (role, status = role === null ? 'not-applicable' : 'resolved', permissions) =>
      set({ activeRole: role, activeRoleStatus: status, activePermissions: permissions ?? [] }),
    invalidateMemberships: () =>
      set((state) => ({ membershipRevision: state.membershipRevision + 1 })),
    setMasquerade: (masquerade) => set({ masquerade }),
  };
};
