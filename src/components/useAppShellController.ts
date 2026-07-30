import { useEffect, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { APP_NAME } from "@capacitylens/shared/brand";
import { m, syncLocaleFromAccount } from "@/i18n";
import { useAccountSummaries } from "../auth/useAccountSummaries";
import { AUDIT_WARNING_EVENT } from "../lib/auditWarning";
import { clearJoinedAccountHandoff, readJoinedAccountHandoff } from "../lib/joinedAccountHandoff";
import { LINKS } from "../lib/navLinks";
import { hasOpenModal, textEntryOwnsShortcut } from "../lib/shortcutGuards";
import { hasUnsavedPersistenceWrites } from "../data/persist";
import { useStore } from "../store/useStore";
import { useAuth } from "../auth/authContext";

/** Owns AppShell's bootstrap handoff, global effects, shortcuts and notice bridge. */
export function useAppShellController() {
  const { authMode } = useAuth();
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
  const hydrated = useStore((state) => state.hydrated);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const setActiveAccount = useStore((state) => state.setActiveAccount);
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [joinedAccountHandoff] = useState(() => readJoinedAccountHandoff(search));
  const joinedAccountUrlCleaned = useRef(false);
  const joinedAccountHandoffConsumed = useRef(false);
  const initialActiveAccountId = useRef(activeAccountId);
  const hydratedActiveAccount = accounts.find((account) => account.id === activeAccountId);
  const activeLanguage = hydratedActiveAccount?.language;
  const activeLanguagePending = activeAccountId !== null && hydratedActiveAccount === undefined;

  useEffect(() => {
    if (!joinedAccountHandoff || joinedAccountUrlCleaned.current) return;
    joinedAccountUrlCleaned.current = true;
    void navigate({ pathname, search: clearJoinedAccountHandoff(search), hash }, { replace: true });
  }, [hash, joinedAccountHandoff, navigate, pathname, search]);

  useEffect(() => {
    // Initial persistence hydration may still publish an empty slice. Activating before that
    // boundary lets replaceAll correctly reject the not-yet-loaded account as missing and drops the
    // caller back onto the picker. Consume the handoff only after hydration has settled; the switch
    // orchestrator can then load the selected account slice without an older bootstrap replacing it.
    if (!hydrated || !joinedAccountHandoff || joinedAccountHandoffConsumed.current) return;
    // activeAccountId is deliberately never persisted. A different non-null value here therefore
    // means the user explicitly chose a company while the requested destination was unavailable;
    // consume the stale handoff so a later directory refresh cannot pull them away from that choice.
    if (
      activeAccountId !== null &&
      activeAccountId !== joinedAccountHandoff &&
      activeAccountId !== initialActiveAccountId.current
    ) {
      joinedAccountHandoffConsumed.current = true;
      return;
    }
    if (accountSummaries.some((account) => account.id === joinedAccountHandoff)) {
      // Account-summary refreshes are expected throughout the shell lifetime. Consume this
      // bootstrap destination before switching so a later refresh cannot pull the user back after
      // they deliberately move to another company.
      joinedAccountHandoffConsumed.current = true;
      setActiveAccount(joinedAccountHandoff);
    }
  }, [accountSummaries, activeAccountId, hydrated, joinedAccountHandoff, setActiveAccount]);

  useEffect(() => {
    // In server mode an account summary becomes active one render before its full slice arrives.
    // Preserve the last authoritative locale through that gap; `undefined` means base locale only
    // once the destination account itself is hydrated (or the picker has no active account).
    if (activeLanguagePending) return;
    syncLocaleFromAccount(activeLanguage);
  }, [activeLanguage, activeLanguagePending]);

  useEffect(() => {
    const match = LINKS.find(([to]) => matchPath({ path: to, end: true }, pathname) !== null);
    document.title = match ? `${match[1]()} · ${APP_NAME}` : APP_NAME;
  }, [pathname, activeLanguage, activeLanguagePending]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyForm && !hasUnsavedPersistenceWrites()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyForm]);

  useEffect(() => {
    if (!notice) return;
    const currentNotice = notice;
    const clear = () => {
      if (useStore.getState().notice === currentNotice) setNotice(null);
    };
    const id =
      currentNotice.tone === "error"
        ? toast.error(currentNotice.message, { duration: Infinity, onDismiss: clear })
        : currentNotice.tone === "warning"
          ? toast(currentNotice.message, { duration: Infinity, onDismiss: clear })
          : toast(currentNotice.message, {
              duration: 4000,
              onDismiss: clear,
              onAutoClose: clear,
            });
    return () => {
      toast.dismiss(id);
    };
  }, [notice, setNotice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (event.isComposing) return;
        if (useStore.getState().dirtyForm) {
          event.preventDefault();
          if (!event.repeat) useStore.getState().setNotice(m.dialog_unsaved_changes());
          return;
        }
        const paletteModal = paletteOpen ? document.querySelector('[data-testid="command-palette"]') : null;
        if (hasOpenModal(paletteModal)) return;
        event.preventDefault();
        if (event.repeat) return;
        setPaletteOpen((open) => !open);
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      if (event.isComposing || textEntryOwnsShortcut(event.target) || hasOpenModal()) return;
      if (useStore.getState().dirtyForm) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, paletteOpen]);

  useEffect(() => {
    const warn = () => setNotice(m.app_audit_log_warning(), "warning");
    globalThis.addEventListener(AUDIT_WARNING_EVENT, warn);
    return () => globalThis.removeEventListener(AUDIT_WARNING_EVENT, warn);
  }, [setNotice]);

  return {
    paletteOpen,
    closePalette: () => setPaletteOpen(false),
  };
}
