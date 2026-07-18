import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { APP_NAME } from '@capacitylens/shared/brand'
import { m, syncLocaleFromAccount } from '@/i18n'
import { useAccountSummaries } from '../auth/useAccountSummaries'
import { AUDIT_WARNING_EVENT } from '../lib/auditWarning'
import { readJoinedAccountHandoff } from '../lib/joinedAccountHandoff'
import { LINKS } from '../lib/navLinks'
import { hasUnsavedPersistenceWrites } from '../data/persist'
import { useStore } from '../store/useStore'

/** Owns AppShell's bootstrap handoff, global effects, shortcuts and notice bridge. */
export function useAppShellController() {
  useAccountSummaries()
  const notice = useStore((state) => state.notice)
  const setNotice = useStore((state) => state.setNotice)
  const dirtyForm = useStore((state) => state.dirtyForm)
  const undo = useStore((state) => state.undo)
  const redo = useStore((state) => state.redo)
  const accounts = useStore((state) => state.data.accounts)
  const accountSummaries = useStore((state) => state.accountSummaries)
  const activeAccountId = useStore((state) => state.activeAccountId)
  const setActiveAccount = useStore((state) => state.setActiveAccount)
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [joinedAccountHandoff] = useState(() => readJoinedAccountHandoff(search))
  const joinedAccountUrlCleaned = useRef(false)
  const activeLanguage = accounts.find((account) => account.id === activeAccountId)?.language

  useEffect(() => {
    if (!joinedAccountHandoff || joinedAccountUrlCleaned.current) return
    joinedAccountUrlCleaned.current = true
    void navigate({ pathname, search: '', hash }, { replace: true })
  }, [hash, joinedAccountHandoff, navigate, pathname])

  useEffect(() => {
    if (!joinedAccountHandoff) return
    if (accountSummaries.some((account) => account.id === joinedAccountHandoff)) {
      setActiveAccount(joinedAccountHandoff)
    }
  }, [accountSummaries, joinedAccountHandoff, setActiveAccount])

  useEffect(() => {
    syncLocaleFromAccount(activeLanguage)
  }, [activeLanguage])

  useEffect(() => {
    const match = LINKS.find(([to]) => to === pathname)
    document.title = match ? `${match[1]()} · ${APP_NAME}` : APP_NAME
  }, [pathname, activeLanguage])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyForm && !hasUnsavedPersistenceWrites()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyForm])

  useEffect(() => {
    if (!notice) return
    const currentNotice = notice
    const clear = () => {
      if (useStore.getState().notice === currentNotice) setNotice(null)
    }
    const id =
      currentNotice.tone === 'error'
        ? toast.error(currentNotice.message, { duration: Infinity, onDismiss: clear })
        : currentNotice.tone === 'warning'
          ? toast(currentNotice.message, { duration: Infinity, onDismiss: clear })
          : toast(currentNotice.message, {
              duration: 4000,
              onDismiss: clear,
              onAutoClose: clear,
            })
    return () => {
      toast.dismiss(id)
    }
  }, [notice, setNotice])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (useStore.getState().dirtyForm) {
          useStore.getState().setNotice(m.dialog_unsaved_changes())
          return
        }
        setPaletteOpen((open) => !open)
        return
      }

      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (useStore.getState().dirtyForm) return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  useEffect(() => {
    const warn = () =>
      setNotice(
        'Your change was saved, but the audit log could not be written. Contact the server administrator.',
        'warning',
      )
    globalThis.addEventListener(AUDIT_WARNING_EVENT, warn)
    return () => globalThis.removeEventListener(AUDIT_WARNING_EVENT, warn)
  }, [setNotice])

  return {
    paletteOpen,
    closePalette: () => setPaletteOpen(false),
  }
}
