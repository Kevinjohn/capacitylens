import type { StateCreator } from "zustand";
import {
  defaultSidebarOpen,
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

function dirtyFormState(state: StoreState, source: symbol, dirty: boolean) {
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
  const persistedFlag =
    <K extends PersistedFlagKey>(key: K, write: (value: boolean) => void) =>
    (value: boolean): void => {
      write(value);
      set({ [key]: value } as Pick<StoreState, K>);
    };
  return {
    hydrated: false,
    persistError: false,
    loadError: false,
    connectionError: false,
    notice: null,
    srAnnouncement: null,
    dirtyForm: false,
    dirtyFormSources: new Set(),
    draggingAllocationId: null,
    theme: readStoredTheme(),
    utilizationPrefs: readStoredUtilizationPrefs(),
    barLabelPrefs: readStoredBarLabelPrefs(),
    sidebarOpen: readStoredSidebarOpen() ?? defaultSidebarOpen(),
    minimiseWeekends: readStoredMinimiseWeekends(),
    snapToWeekStart: readStoredSnapToWeekStart(),
    compactView: readStoredCompactView(),
    fakeSignedIn: readStoredFakeSignedIn(),
    introSeen: readStoredIntroSeen(),
    gettingStartedDismissed: readStoredGettingStartedDismissed(),
    activeRole: null,
    activeRoleStatus: "not-applicable",
    membershipRevision: 0,
    masquerade: { phase: "inactive" },

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
    setDirtyForm: (value) => set((state) => dirtyFormState(state, legacyDirtyFormSource, value)),
    setDirtyFormSource: (source, dirty) => set((state) => dirtyFormState(state, source, dirty)),
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
    setSidebarOpen: persistedFlag("sidebarOpen", writeStoredSidebarOpen),
    setMinimiseWeekends: persistedFlag("minimiseWeekends", writeStoredMinimiseWeekends),
    setSnapToWeekStart: persistedFlag("snapToWeekStart", writeStoredSnapToWeekStart),
    setCompactView: persistedFlag("compactView", writeStoredCompactView),
    setFakeSignedIn: persistedFlag("fakeSignedIn", writeStoredFakeSignedIn),
    setIntroSeen: persistedFlag("introSeen", writeStoredIntroSeen),
    setGettingStartedDismissed: persistedFlag("gettingStartedDismissed", writeStoredGettingStartedDismissed),
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
