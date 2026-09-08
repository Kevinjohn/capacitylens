import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { APP_NAME } from "@capacitylens/shared/brand";
import { m, syncLocaleFromAccount } from "@/i18n";
import { useAccountSummaries } from "../auth/useAccountSummaries";
import { AUDIT_WARNING_EVENT } from "../lib/auditWarning";
import { clearJoinedAccountHandoff, readJoinedAccountHandoff } from "../lib/joinedAccountHandoff";
import { ADMIN_LINKS, LINKS } from "../lib/navLinks";
import { hasOpenModal, isTextEntryShortcutOwner } from "../lib/shortcutGuards";
import { hasUnsavedPersistenceWrites } from "../data/persist";
import { useStore } from "../store/useStore";
import { useAuth } from "../auth/authContext";
import { useDemoAuthActive } from "../lib/fakeAuth";
import { consumeCompanyPickerForReload } from "../lib/companyPickerEntry";
import { transitionAccount } from "../auth/accountTransition";

function readReloadNavigationState(): boolean {
  try {
    return globalThis.performance
      .getEntriesByType("navigation")
      .some((entry) => (entry as PerformanceNavigationTiming).type === "reload");
  } catch (error) {
    console.warn("The browser navigation type could not be read; keeping the company picker", error);
    return false;
  }
}

type StoreState = ReturnType<typeof useStore.getState>;

interface JoinedAccountHandoffInput {
  accountSummaries: StoreState["accountSummaries"];
  activeAccountId: StoreState["activeAccountId"];
  hash: string;
  hydrated: boolean;
  navigate: ReturnType<typeof useNavigate>;
  pathname: string;
  search: string;
}

function useJoinedAccountHandoff(input: JoinedAccountHandoffInput) {
  const { accountSummaries, activeAccountId, hash, hydrated, navigate, pathname, search } = input;
  const [joinedAccountHandoff] = useState(() => readJoinedAccountHandoff(search));
  const joinedAccountUrlCleaned = useRef(false);
  const joinedAccountHandoffConsumed = useRef(false);
  const initialActiveAccountId = useRef(activeAccountId);

  useEffect(() => {
    if (!joinedAccountHandoff || joinedAccountUrlCleaned.current) return;
    joinedAccountUrlCleaned.current = true;
    void navigate({ pathname, search: clearJoinedAccountHandoff(search), hash }, { replace: true });
  }, [hash, joinedAccountHandoff, navigate, pathname, search]);

  useEffect(() => {
    // Wait for persistence hydration so the switch cannot race an older bootstrap replacement.
    if (!hydrated || !joinedAccountHandoff || joinedAccountHandoffConsumed.current) return;
    const userSelectedAnotherAccount =
      activeAccountId !== null &&
      activeAccountId !== joinedAccountHandoff &&
      activeAccountId !== initialActiveAccountId.current;
    if (userSelectedAnotherAccount) {
      joinedAccountHandoffConsumed.current = true;
      return;
    }
    if (!accountSummaries.some((account) => account.id === joinedAccountHandoff)) return;

    joinedAccountHandoffConsumed.current = true;
    void transitionAccount(joinedAccountHandoff);
  }, [accountSummaries, activeAccountId, hydrated, joinedAccountHandoff]);

  return joinedAccountHandoff;
}

interface SingleAccountReloadInput {
  accountSummaries: StoreState["accountSummaries"];
  accountSummariesComplete: boolean;
  activeAccountId: StoreState["activeAccountId"];
  demoAuthActive: boolean;
  fakeSignedIn: boolean;
  hydrated: boolean;
  joinedAccountHandoff: ReturnType<typeof readJoinedAccountHandoff>;
  previousAccountId: StoreState["previousAccountId"];
}

function findSingleAccountForReload(input: SingleAccountReloadInput, showPickerForReload: boolean) {
  const account = input.accountSummaries[0];
  if (
    input.joinedAccountHandoff !== null ||
    showPickerForReload ||
    input.activeAccountId !== null ||
    input.previousAccountId !== null ||
    (input.demoAuthActive && !input.fakeSignedIn) ||
    !input.accountSummariesComplete ||
    input.accountSummaries.length !== 1 ||
    account?.roleStatus === "unavailable"
  ) {
    return undefined;
  }
  return account;
}

function useSingleAccountReload(input: SingleAccountReloadInput) {
  const {
    accountSummaries,
    accountSummariesComplete,
    activeAccountId,
    demoAuthActive,
    fakeSignedIn,
    hydrated,
    joinedAccountHandoff,
    previousAccountId,
  } = input;
  const [reloadNavigation] = useState(readReloadNavigationState);
  const [showPickerForReload] = useState(consumeCompanyPickerForReload);
  const singleAccountReloadHandled = useRef(false);

  useEffect(() => {
    if (!reloadNavigation || !hydrated || singleAccountReloadHandled.current) return;
    if (accountSummaries.length === 0) return;

    singleAccountReloadHandled.current = true;
    const account = findSingleAccountForReload(
      {
        accountSummaries,
        accountSummariesComplete,
        activeAccountId,
        demoAuthActive,
        fakeSignedIn,
        hydrated,
        joinedAccountHandoff,
        previousAccountId,
      },
      showPickerForReload,
    );
    if (!account) return;

    void transitionAccount(account.id);
  }, [
    accountSummaries,
    accountSummariesComplete,
    activeAccountId,
    demoAuthActive,
    fakeSignedIn,
    hydrated,
    joinedAccountHandoff,
    previousAccountId,
    reloadNavigation,
    showPickerForReload,
  ]);
}

function useAccountLocale(accounts: StoreState["data"]["accounts"], activeAccountId: StoreState["activeAccountId"]) {
  const hydratedActiveAccount = accounts.find((account) => account.id === activeAccountId);
  const activeLanguage = hydratedActiveAccount?.language;
  const activeLanguagePending = activeAccountId !== null && hydratedActiveAccount === undefined;

  useEffect(() => {
    if (activeLanguagePending) return;
    syncLocaleFromAccount(activeLanguage);
  }, [activeLanguage, activeLanguagePending]);

  return { activeLanguage, activeLanguagePending };
}

function useDocumentTitle(
  pathname: string,
  activeLanguage: StoreState["data"]["accounts"][number]["language"] | undefined,
  activeLanguagePending: boolean,
) {
  useEffect(() => {
    const match = [...LINKS, ...ADMIN_LINKS].find(({ to }) => matchPath({ path: to, end: true }, pathname) !== null);
    document.title = match ? `${match.label()} · ${APP_NAME}` : APP_NAME;
  }, [pathname, activeLanguage, activeLanguagePending]);
}

function useBeforeUnloadWarning(dirtyForm: boolean) {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyForm && !hasUnsavedPersistenceWrites()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyForm]);
}

function showNoticeToast(notice: NonNullable<StoreState["notice"]>, clear: () => void) {
  if (notice.tone === "error") return toast.error(notice.message, { duration: Infinity, onDismiss: clear });
  if (notice.tone === "warning") return toast(notice.message, { duration: Infinity, onDismiss: clear });
  return toast(notice.message, { duration: 4000, onDismiss: clear, onAutoClose: clear });
}

function useNoticeBridge(notice: StoreState["notice"], setNotice: StoreState["setNotice"]) {
  useEffect(() => {
    if (!notice) return;
    const currentNotice = notice;
    const clear = () => {
      if (useStore.getState().notice === currentNotice) setNotice(null);
    };
    const id = showNoticeToast(currentNotice, clear);
    return () => {
      toast.dismiss(id);
    };
  }, [notice, setNotice]);
}

interface GlobalShortcutsInput {
  paletteOpen: boolean;
  redo: StoreState["redo"];
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  undo: StoreState["undo"];
}

type PaletteShortcutInput = Pick<GlobalShortcutsInput, "paletteOpen" | "setPaletteOpen">;
type HistoryShortcutInput = Pick<GlobalShortcutsInput, "redo" | "undo">;

function handlePaletteShortcut(event: KeyboardEvent, input: PaletteShortcutInput): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return false;
  if (event.isComposing) return true;
  if (useStore.getState().dirtyForm) {
    event.preventDefault();
    if (!event.repeat) useStore.getState().setNotice(m.dialog_unsaved_changes());
    return true;
  }
  const paletteModal = input.paletteOpen ? document.querySelector('[data-testid="command-palette"]') : null;
  if (hasOpenModal(paletteModal)) return true;
  event.preventDefault();
  if (!event.repeat) input.setPaletteOpen((open) => !open);
  return true;
}

function handleHistoryShortcut(event: KeyboardEvent, input: HistoryShortcutInput) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
  if (event.isComposing || isTextEntryShortcutOwner(event.target) || hasOpenModal()) return;
  if (useStore.getState().dirtyForm) return;
  event.preventDefault();
  if (event.shiftKey) input.redo();
  else input.undo();
}

function useGlobalShortcuts(input: GlobalShortcutsInput) {
  const { paletteOpen, redo, setPaletteOpen, undo } = input;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!handlePaletteShortcut(event, { paletteOpen, setPaletteOpen })) {
        handleHistoryShortcut(event, { redo, undo });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, redo, setPaletteOpen, undo]);
}

function useAuditWarning(setNotice: StoreState["setNotice"]) {
  useEffect(() => {
    const warn = () => setNotice(m.app_audit_log_warning(), "warning");
    globalThis.addEventListener(AUDIT_WARNING_EVENT, warn);
    return () => globalThis.removeEventListener(AUDIT_WARNING_EVENT, warn);
  }, [setNotice]);
}

/** Owns AppShell's bootstrap handoff, global effects, shortcuts and notice bridge. */
export function useAppShellController() {
  const { authMode } = useAuth();
  const demoAuthActive = useDemoAuthActive();
  // In auth-on mode PermissionProvider owns the active-account refresh and publishes the same
  // validated list to the store. The shell hook still owns picker reads; auth-off has no permission
  // lookup, so it continues refreshing the active directory itself.
  useAccountSummaries({ refreshActiveAccount: authMode === "off" });
  const notice = useStore((state) => state.notice);
  const setNotice = useStore((state) => state.setNotice);
  const dirtyForm = useStore((state) => state.dirtyForm);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const accounts = useStore((state) => state.data.accounts);
  const accountSummaries = useStore((state) => state.accountSummaries);
  const accountSummariesComplete = useStore((state) => state.accountSummariesComplete);
  const hydrated = useStore((state) => state.hydrated);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const previousAccountId = useStore((state) => state.previousAccountId);
  const fakeSignedIn = useStore((state) => state.fakeSignedIn);
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const joinedAccountHandoff = useJoinedAccountHandoff({
    accountSummaries,
    activeAccountId,
    hash,
    hydrated,
    navigate,
    pathname,
    search,
  });
  useSingleAccountReload({
    accountSummaries,
    accountSummariesComplete,
    activeAccountId,
    demoAuthActive,
    fakeSignedIn,
    hydrated,
    joinedAccountHandoff,
    previousAccountId,
  });
  const { activeLanguage, activeLanguagePending } = useAccountLocale(accounts, activeAccountId);
  useDocumentTitle(pathname, activeLanguage, activeLanguagePending);
  useBeforeUnloadWarning(dirtyForm);
  useNoticeBridge(notice, setNotice);
  useGlobalShortcuts({ paletteOpen, redo, setPaletteOpen, undo });
  useAuditWarning(setNotice);

  return {
    paletteOpen,
    closePalette: () => setPaletteOpen(false),
  };
}
