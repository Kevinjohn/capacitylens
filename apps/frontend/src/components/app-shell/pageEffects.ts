import { useEffect } from 'react'
import { matchPath } from 'react-router-dom'
import { APP_NAME } from '@capacitylens/shared/brand'
import { syncLocaleFromCompany } from '@/i18n'
import { APP_ROUTES } from '@/lib/navLinks'
import { useStore } from '@/store/useStore'
import type { StoreState } from '@/store/types'

// The browser page around the shell: the active company's locale, the document title and the
// unload warning while work is unsaved.

/** Applies the active company's language once its company row has loaded. */
export function useCompanyLocale(
  companies: StoreState['data']['companies'],
  activeCompanyId: StoreState['activeCompanyId']
) {
  const hydratedActiveCompany = companies.find((company) => company.id === activeCompanyId)
  const activeLanguage = hydratedActiveCompany?.language
  const activeLanguagePending = activeCompanyId !== null && hydratedActiveCompany === undefined

  useEffect(() => {
    if (activeLanguagePending) return
    syncLocaleFromCompany(activeLanguage ?? undefined)
  }, [activeLanguage, activeLanguagePending])

  return { activeLanguage, activeLanguagePending }
}

interface DocumentTitleInput {
  activeLanguage: StoreState['data']['companies'][number]['language'] | undefined
  activeLanguagePending: boolean
  pathname: string
}

/** Names the document after the current section. */
export function useDocumentTitle(input: DocumentTitleInput) {
  const { activeLanguage, activeLanguagePending, pathname } = input
  useEffect(() => {
    // Titles name every route, visible or not: a guarded route redirects on its own.
    const match = APP_ROUTES.find(({ to }) => matchPath({ path: to, end: true }, pathname) !== null)
    document.title = match ? `${match.label()} · ${APP_NAME}` : APP_NAME
  }, [pathname, activeLanguage, activeLanguagePending])
}

/** Warns before unload while a form is dirty or a planning write is pending. */
export function useBeforeUnloadWarning(dirtyForm: boolean) {
  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyForm && useStore.getState().planning.phase.kind !== 'writing') return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [dirtyForm])
}
