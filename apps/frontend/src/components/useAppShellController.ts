import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAccountSummaries } from '@/auth/useAccountSummaries';
import { useStore } from '@/store/useStore';
import { useJoinedAccountHandoff, useSingleAccountReload } from './app-shell/accountEntry';
import {
  useAccountLocale,
  useBeforeUnloadWarning,
  useDocumentTitle,
} from './app-shell/pageEffects';
import { useAuditWarning, useNoticeBridge } from './app-shell/shellNotices';
import { useGlobalShortcuts } from './app-shell/globalShortcuts';

/** Owns AppShell's bootstrap handoff, global effects, shortcuts and notice bridge. */
export function useAppShellController() {
  // PermissionProvider owns active-account refreshes and publishes the validated directory.
  useAccountSummaries();
  const notice = useStore((state) => state.notice);
  const setNotice = useStore((state) => state.setNotice);
  const dirtyForm = useStore((state) => state.dirtyForm);
  const undo = useStore((state) => state.undoPlanning);
  const redo = useStore((state) => state.redoPlanning);
  const accounts = useStore((state) => state.data.accounts);
  const accountSummaries = useStore((state) => state.accountSummaries);
  const accountSummariesComplete = useStore((state) => state.accountSummariesComplete);
  const hydrated = useStore((state) => state.hydrated);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  useJoinedAccountHandoff({
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
    hydrated,
  });
  const { activeLanguage, activeLanguagePending } = useAccountLocale(accounts, activeAccountId);
  useDocumentTitle({ activeLanguage, activeLanguagePending, pathname });
  useBeforeUnloadWarning(dirtyForm);
  useNoticeBridge(notice, setNotice);
  useGlobalShortcuts({ paletteOpen, redo, setPaletteOpen, undo });
  useAuditWarning(setNotice);

  return {
    paletteOpen,
    closePalette: () => setPaletteOpen(false),
  };
}
