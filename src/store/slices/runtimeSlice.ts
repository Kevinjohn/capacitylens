import type { StateCreator } from "zustand";
import {
  readDefaultSidebarOpen,
  readStoredBarLabelPrefs,
  readStoredFakeSignedIn,
  readStoredGettingStartedDismissed,
  readStoredIntroSeen,
  readStoredMinimiseWeekends,
  readStoredSidebarOpen,
  readStoredCompactView,
  readStoredSnapToWeekStart,
  readStoredUtilizationPrefs,
  writeStoredBarLabelPrefs,
  writeStoredFakeSignedIn,
  writeStoredGettingStartedDismissed,
  writeStoredIntroSeen,
  writeStoredMinimiseWeekends,
  writeStoredSidebarOpen,
  writeStoredCompactView,
  writeStoredSnapToWeekStart,
  writeStoredUtilizationPrefs,
} from "../../lib/displayPrefs";
import { applyThemeToDom, readStoredTheme, writeStoredTheme } from "../../lib/theme";
import type { StoreState } from "../types";

type RuntimeSliceKeys =
  | "hydrated"
  | "persistError"
  | "loadError"
  | "connectionError"
  | "activeAccountLoadFailed"
  | "notice"
  | "srAnnouncement"
  | "dirtyForm"
  | "dirtyFormSources"
  | "draggingAllocationId"
  | "theme"
  | "utilizationPrefs"
  | "barLabelPrefs"
  | "sidebarOpen"
  | "minimiseWeekends"
  | "snapToWeekStart"
  | "compactView"
  | "fakeSignedIn"
  | "introSeen"
  | "gettingStartedDismissed"
  | "activeRole"
  | "activeRoleStatus"
  | "membershipRevision"
  | "masquerade"
  | "setHydrated"
  | "setPersistError"
  | "setLoadError"
  | "setConnectionError"
  | "setNotice"
  | "announceCapacity"
  | "setDirtyForm"
  | "setDirtyFormSource"
  | "setDraggingAllocation"
  | "setTheme"
  | "setUtilizationPref"
  | "setBarLabelPref"
  | "setSidebarOpen"
  | "setMinimiseWeekends"
  | "setSnapToWeekStart"
  | "setCompactView"
  | "setFakeSignedIn"
  | "setIntroSeen"
  | "setGettingStartedDismissed"
  | "setActiveRole"
  | "invalidateMemberships"
  | "setMasquerade"
  | "clearUndoHistory"
  | "signOutDemo";

type RuntimeSlice = Pick<StoreState, RuntimeSliceKeys>;

/** The device-global boolean prefs, each persisted under its own localStorage key. */
type PersistedFlagKey =
  | "sidebarOpen"
  | "minimiseWeekends"
  | "snapToWeekStart"
  | "compactView"
  | "fakeSignedIn"
  | "introSeen"
  | "gettingStartedDismissed";

const legacyDirtyFormSource = Symbol("setDirtyForm");

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
    persistError: false,
    loadError: false,
    connectionError: false,
    activeAccountLoadFailed: null,
    notice: null,
    srAnnouncement: null,
    dirtyForm: false,
    dirtyFormSources: new Set<symbol>(),
    draggingAllocationId: null,
    theme: readStoredTheme(),
    utilizationPrefs: readStoredUtilizationPrefs(),
    barLabelPrefs: readStoredBarLabelPrefs(),
    sidebarOpen: readStoredSidebarOpen() ?? readDefaultSidebarOpen(),
    minimiseWeekends: readStoredMinimiseWeekends(),
    snapToWeekStart: readStoredSnapToWeekStart(),
    compactView: readStoredCompactView(),
    fakeSignedIn: readStoredFakeSignedIn(),
    introSeen: readStoredIntroSeen(),
    gettingStartedDismissed: readStoredGettingStartedDismissed(),
    activeRole: null,
    activeRoleStatus: "not-applicable" as const,
    membershipRevision: 0,
    masquerade: { kind: "inactive" as const },
  };
}

function applyDirtyFormSource(state: StoreState, source: symbol, dirty: boolean) {
  const dirtyFormSources = new Set(state.dirtyFormSources);
  if (dirty) dirtyFormSources.add(source);
  else dirtyFormSources.delete(source);
  return { dirtyFormSources, dirtyForm: dirtyFormSources.size > 0 };
}

/** Device preferences and transient application/session state. */
export const createRuntimeSlice: StateCreator<StoreState, [], [], RuntimeSlice> = (set, get) => {
  // Every device-global preference setter has the same body — write the pref to its own
  // localStorage key, then publish it — so the shape is declared ONCE here and each setter below
  // names only its key and its writer. setTheme stays bespoke: it also repaints the DOM.
  return {
    ...readRuntimeInitialState(),

    setHydrated: (value) => set({ hydrated: value }),
    setPersistError: (value) => set({ persistError: value }),
    setLoadError: (value) => set({ loadError: value }),
    setConnectionError: (value) => set({ connectionError: value }),
    setNotice: (message, tone = "info") => set({ notice: message ? { message, tone } : null }),
    announceCapacity: (text) =>
      set((state) => ({
        srAnnouncement: { text, seq: (state.srAnnouncement?.seq ?? 0) + 1 },
      })),
    // Retain the boolean API as one owned source. Component publishers use setDirtyFormSource so
    // clearing one contribution can never erase another still-dirty owner.
    setDirtyForm: (value) => set((state) => applyDirtyFormSource(state, legacyDirtyFormSource, value)),
    setDirtyFormSource: (source, dirty) => set((state) => applyDirtyFormSource(state, source, dirty)),
    setDraggingAllocation: (id) => set({ draggingAllocationId: id }),
    setTheme: (preference) => {
      writeStoredTheme(preference);
      applyThemeToDom(preference);
      set({ theme: preference });
    },
    // The two pref MAPS stay written out: a shared factory over them needs a double cast to keep
    // the mapped key/value pair typed, which costs more clarity than the four lines it saves.
    setUtilizationPref: (key, value) =>
      set((state) => {
        const next = { ...state.utilizationPrefs, [key]: value };
        writeStoredUtilizationPrefs(next);
        return { utilizationPrefs: next };
      }),
    setBarLabelPref: (key, value) =>
      set((state) => {
        const next = { ...state.barLabelPrefs, [key]: value };
        writeStoredBarLabelPrefs(next);
        return { barLabelPrefs: next };
      }),
    setSidebarOpen: createPersistedFlagSetter(set, "sidebarOpen", (open) => writeStoredSidebarOpen({ open })),
    setMinimiseWeekends: createPersistedFlagSetter(set, "minimiseWeekends", writeStoredMinimiseWeekends),
    setSnapToWeekStart: createPersistedFlagSetter(set, "snapToWeekStart", writeStoredSnapToWeekStart),
    setCompactView: createPersistedFlagSetter(set, "compactView", writeStoredCompactView),
    setFakeSignedIn: createPersistedFlagSetter(set, "fakeSignedIn", writeStoredFakeSignedIn),
    setIntroSeen: createPersistedFlagSetter(set, "introSeen", writeStoredIntroSeen),
    setGettingStartedDismissed: createPersistedFlagSetter(
      set,
      "gettingStartedDismissed",
      writeStoredGettingStartedDismissed,
    ),
    setActiveRole: (role, status = role === null ? "not-applicable" : "resolved") =>
      set({ activeRole: role, activeRoleStatus: status }),
    invalidateMemberships: () => set((state) => ({ membershipRevision: state.membershipRevision + 1 })),
    setMasquerade: (masquerade) => set({ masquerade }),
    clearUndoHistory: () => set({ past: [], future: [] }),
    signOutDemo: () => {
      get().setActiveAccount(null);
      writeStoredFakeSignedIn(false);
      set({ previousAccountId: null, fakeSignedIn: false });
    },
  };
};
