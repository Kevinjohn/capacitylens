import { useEffect } from 'react';
import { matchPath } from 'react-router-dom';
import { APP_NAME } from '@capacitylens/shared/brand';
import { syncLocaleFromAccount } from '@/i18n';
import { APP_ROUTES } from '@/lib/navLinks';
import { useStore } from '@/store/useStore';

// The browser page around the shell: the active company's locale, the document title and the
// unload warning while work is unsaved.

type StoreState = ReturnType<typeof useStore.getState>;

/** Applies the active company's language once its account row has loaded. */
export function useAccountLocale(
  accounts: StoreState['data']['accounts'],
  activeAccountId: StoreState['activeAccountId'],
) {
  const hydratedActiveAccount = accounts.find((account) => account.id === activeAccountId);
  const activeLanguage = hydratedActiveAccount?.language;
  const activeLanguagePending = activeAccountId !== null && hydratedActiveAccount === undefined;

  useEffect(() => {
    if (activeLanguagePending) return;
    syncLocaleFromAccount(activeLanguage ?? undefined);
  }, [activeLanguage, activeLanguagePending]);

  return { activeLanguage, activeLanguagePending };
}

interface DocumentTitleInput {
  activeLanguage: StoreState['data']['accounts'][number]['language'] | undefined;
  activeLanguagePending: boolean;
  pathname: string;
}

/** Names the document after the current section. */
export function useDocumentTitle(input: DocumentTitleInput) {
  const { activeLanguage, activeLanguagePending, pathname } = input;
  useEffect(() => {
    // Titles name every route, visible or not: a guarded route redirects on its own.
    const match = APP_ROUTES.find(
      ({ to }) => matchPath({ path: to, end: true }, pathname) !== null,
    );
    document.title = match ? `${match.label()} · ${APP_NAME}` : APP_NAME;
  }, [pathname, activeLanguage, activeLanguagePending]);
}

interface BeforeUnloadWarningInput {
  dirtyForm: boolean;
}

/** Warns before unload while a form is dirty or a planning write is pending. */
export function useBeforeUnloadWarning(input: BeforeUnloadWarningInput) {
  const { dirtyForm } = input;
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyForm && useStore.getState().planning.pending === null) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtyForm]);
}
