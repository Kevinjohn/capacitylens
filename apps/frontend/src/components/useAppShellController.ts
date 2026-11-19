import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCompanySummaries } from '@/auth/useAccountSummaries';
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
  useCompanySummaries();
  const notice = useStore((state) => state.notice);
  const setNotice = useStore((state) => state.setNotice);
  const dirtyForm = useStore((state) => state.dirtyForm);
  const undo = useStore((state) => state.undoPlanning);
  const redo = useStore((state) => state.redoPlanning);
  const accounts = useStore((state) => state.data.accounts);
  const companySummaries = useStore((state) => state.companySummaries);
  const companySummariesComplete = useStore((state) => state.companySummariesComplete);
  const hydrated = useStore((state) => state.hydrated);
  const activeCompanyId = useStore((state) => state.activeCompanyId);
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  useJoinedAccountHandoff({
    companySummaries,
    activeCompanyId,
    hash,
    hydrated,
    navigate,
    pathname,
    search,
  });
  useSingleAccountReload({
    companySummaries,
    companySummariesComplete,
    activeCompanyId,
    hydrated,
  });
  const { activeLanguage, activeLanguagePending } = useAccountLocale(accounts, activeCompanyId);
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
