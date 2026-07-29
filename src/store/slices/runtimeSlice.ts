import type { StateCreator } from "zustand";
import {
  defaultSidebarOpen,
  readStoredBarLabelPrefs,
  readStoredFakeSignedIn,
  readStoredGettingStartedDismissed,
  readStoredIntroSeen,
  readStoredMinimiseWeekends,
  readStoredSidebarOpen,
  readStoredSnapToWeekStart,
  readStoredUtilizationPrefs,
  writeStoredBarLabelPrefs,
  writeStoredFakeSignedIn,
  writeStoredGettingStartedDismissed,
  writeStoredIntroSeen,
  writeStoredMinimiseWeekends,
  writeStoredSidebarOpen,
  writeStoredSnapToWeekStart,
  writeStoredUtilizationPrefs,
} from "../../lib/displayPrefs";
import { applyThemeToDom, readStoredTheme, writeStoredTheme } from "../../lib/theme";
import type { StoreState } from "../useStore";

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
  | "fakeSignedIn"
  | "introSeen"
  | "gettingStartedDismissed"
  | "activeRole"
  | "activeRoleStatus"
  | "membershipRevision"
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
  | "setFakeSignedIn"
  | "setIntroSeen"
  | "setGettingStartedDismissed"
  | "setActiveRole"
  | "invalidateMemberships"
  | "signOutDemo";

export type RuntimeSlice = Pick<StoreState, RuntimeSliceKeys>;

const legacyDirtyFormSource = Symbol("setDirtyForm");

function dirtyFormState(state: StoreState, source: symbol, dirty: boolean) {
  const dirtyFormSources = new Set(state.dirtyFormSources);
  if (dirty) dirtyFormSources.add(source);
  else dirtyFormSources.delete(source);
  return { dirtyFormSources, dirtyForm: dirtyFormSources.size > 0 };
}

/** Device preferences and transient application/session state. */
export const createRuntimeSlice: StateCreator<StoreState, [], [], RuntimeSlice> = (set, get) => ({
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
  fakeSignedIn: readStoredFakeSignedIn(),
  introSeen: readStoredIntroSeen(),
  gettingStartedDismissed: readStoredGettingStartedDismissed(),
  activeRole: null,
  activeRoleStatus: "not-applicable",
  membershipRevision: 0,

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
  setSidebarOpen: (open) => {
    writeStoredSidebarOpen(open);
    set({ sidebarOpen: open });
  },
  setMinimiseWeekends: (value) => {
    writeStoredMinimiseWeekends(value);
    set({ minimiseWeekends: value });
  },
  setSnapToWeekStart: (value) => {
    writeStoredSnapToWeekStart(value);
    set({ snapToWeekStart: value });
  },
  setFakeSignedIn: (value) => {
    writeStoredFakeSignedIn(value);
    set({ fakeSignedIn: value });
  },
  setIntroSeen: (value) => {
    writeStoredIntroSeen(value);
    set({ introSeen: value });
  },
  setGettingStartedDismissed: (value) => {
    writeStoredGettingStartedDismissed(value);
    set({ gettingStartedDismissed: value });
  },
  setActiveRole: (role, status = role === null ? "not-applicable" : "resolved") =>
    set({ activeRole: role, activeRoleStatus: status }),
  invalidateMemberships: () => set((state) => ({ membershipRevision: state.membershipRevision + 1 })),
  signOutDemo: () => {
    get().setActiveAccount(null);
    writeStoredFakeSignedIn(false);
    set({ previousAccountId: null, fakeSignedIn: false });
  },
});
