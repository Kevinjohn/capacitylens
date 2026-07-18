import { useCallback, useEffect, useRef, useState } from 'react'
import { m } from '@/i18n'
import { errorMessage } from '../../lib/errorMessage'
import { teamAccessClient, type TeamInvitation, type TeamMember } from '../../account/teamAccessClient'
import type { FieldError } from '../../hooks/useFieldError'

interface TeamDirectoryOptions {
  enabled: boolean
  activeAccountId: string | null
  offlineReadOnly: boolean
  fail: FieldError['fail']
  onInvitesLoaded?: (invites: TeamInvitation[]) => void
}

/** Owns authoritative directory reads, self-gating, reload generations and action exclusion. */
export function useTeamDirectory({
  enabled,
  activeAccountId,
  offlineReadOnly,
  fail,
  onInvitesLoaded,
}: TeamDirectoryOptions) {
  const [directory, setDirectory] = useState<{
    accountId: string | null
    members: TeamMember[] | null
    invites: TeamInvitation[]
    gate: 'loading' | 'shown' | 'hidden' | 'error'
  }>({ accountId: null, members: null, invites: [], gate: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const requestGeneration = useRef(0)
  const actionLock = useRef<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])
  const beginAction = useCallback((key: string): boolean => {
    if (actionLock.current !== null) return false
    actionLock.current = key
    setBusyAction(key)
    return true
  }, [])
  const endAction = useCallback(() => {
    actionLock.current = null
    setBusyAction(null)
  }, [])

  useEffect(() => {
    if (!enabled || !activeAccountId || offlineReadOnly) return
    const generation = ++requestGeneration.current
    let cancelled = false
    const current = () => !cancelled && requestGeneration.current === generation

    void (async () => {
      let membersLoaded = false
      try {
        const membersResult = await teamAccessClient.listMembers(activeAccountId)
        if (membersResult.kind === 'rejected' && membersResult.status === 403) {
          if (current()) {
            setDirectory({ accountId: activeAccountId, members: null, invites: [], gate: 'hidden' })
          }
          return
        }
        if (membersResult.kind === 'invalid') {
          throw new Error('The server returned an invalid members response.')
        }
        if (membersResult.kind !== 'ok') {
          if (!current()) return
          setDirectory({ accountId: activeAccountId, members: null, invites: [], gate: 'error' })
          fail(
            null,
            membersResult.kind === 'rejected' && membersResult.message
              ? membersResult.message
              : m.settings_members_err_load({ status: membersResult.status }),
          )
          return
        }
        if (!current()) return
        setDirectory((previous) => ({
          accountId: activeAccountId,
          members: membersResult.value,
          // Preserve the last authoritative invitation list while a same-account refresh is in
          // flight. On an account switch, the old list is both hidden by the account key below and
          // discarded here before this account's separately-authorized invite read completes.
          invites: previous.accountId === activeAccountId ? previous.invites : [],
          gate: 'shown',
        }))
        membersLoaded = true

        const invitationsResult = await teamAccessClient.listInvitations(activeAccountId)
        if (invitationsResult.kind === 'invalid') {
          throw new Error('The server returned an invalid invites response.')
        }
        if (invitationsResult.kind !== 'ok') {
          if (!current()) return
          fail(
            null,
            invitationsResult.kind === 'rejected' && invitationsResult.message
              ? invitationsResult.message
              : m.settings_members_err_load({ status: invitationsResult.status }),
          )
          return
        }
        if (current()) {
          setDirectory((previous) => previous.accountId === activeAccountId
            ? { ...previous, invites: invitationsResult.value }
            : previous)
          onInvitesLoaded?.(invitationsResult.value)
        }
      } catch (error) {
        if (!current()) return
        if (!membersLoaded) {
          setDirectory({ accountId: activeAccountId, members: null, invites: [], gate: 'error' })
        }
        fail(null, m.settings_err_server({ error: errorMessage(error) }))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, activeAccountId, reloadKey, fail, offlineReadOnly, onInvitesLoaded])

  const currentAccountLoaded = directory.accountId === activeAccountId

  const replaceDirectory = useCallback((members: TeamMember[], invites: TeamInvitation[]) => {
    setDirectory((previous) => ({ ...previous, members, invites }))
  }, [])

  return {
    members: currentAccountLoaded ? directory.members : null,
    invites: currentAccountLoaded ? directory.invites : [],
    gate: currentAccountLoaded ? directory.gate : 'loading',
    replaceDirectory,
    reload,
    busyAction,
    beginAction,
    endAction,
  }
}
