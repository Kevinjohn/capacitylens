import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { m } from '@/i18n'
import { teamAccessApi } from '@/account/teamAccessApi'
import type { TeamMember } from '@/account/teamAccessApi'
import { resolveRefusalMessage } from '@/account/accessResult'
import type { ApiQueryScope } from '@/api/queryClient'
import { useQueryScope } from '@/api/useQueryScope'
import { useAuth } from '@/auth/authContext'
import { useCan, usePermissionStatus } from '@/auth/permissionContext'
import { reprojectAccess } from '@/auth/reprojectAccess'
import { readTeamMembers, TeamReadError, teamMembersQueryKey } from './useTeamDirectory'
import { useStore } from '@/store/useStore'

interface OwnershipTransferState {
  available: boolean
  loading: boolean
  directoryLoaded: boolean
  candidates: readonly TeamMember[]
  busy: boolean
  error: string | null
}

export interface OwnershipTransferViewModel extends OwnershipTransferState {
  refresh(): Promise<void>
  transfer(targetUserId: string, confirmationId: string): Promise<void>
}

const EMPTY_MEMBERS: readonly TeamMember[] = []
type OwnershipTransferResult = Awaited<ReturnType<typeof teamAccessApi.transferOwnership>>

function useOwnerDirectory({
  companyId,
  available,
  scope,
  userId,
}: {
  companyId: string | null
  available: boolean
  scope: ApiQueryScope
  userId: string | null
}) {
  // The same members query the team directory reads, so the list is held once.
  const query = useQuery({
    queryKey: teamMembersQueryKey(scope, companyId),
    enabled: available && companyId !== null,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: ({ signal }) => readTeamMembers(companyId ?? '', signal),
  })
  const members = query.isSuccess ? query.data.members : EMPTY_MEMBERS
  const candidates = useMemo(
    () =>
      members.filter(
        (member) =>
          member.role === 'admin' && member.status === 'active' && member.userId !== userId
      ),
    [members, userId]
  )
  const error = readDirectoryError(query.error)
  const refresh = useCallback(async (): Promise<void> => {
    await query.refetch()
  }, [query])

  return {
    candidates,
    error,
    loading: query.isPending,
    loaded: query.isSuccess,
    refresh,
  }
}

function readDirectoryError(error: Error | null): string | null {
  if (error instanceof TeamReadError) {
    return resolveRefusalMessage(error.result, m.ownership_transfer_read_failed())
  }
  return error ? m.ownership_transfer_read_failed() : null
}

async function reconcileCallerAccess(
  queryClient: QueryClient,
  companyId: string,
  refreshAuth: () => Promise<void>
): Promise<boolean> {
  queryClient.clear()
  try {
    await refreshAuth()
  } catch (cause) {
    console.error('OwnershipTransferCard: authentication refresh failed', cause)
  }
  if (useStore.getState().activeCompanyId !== companyId) return true
  try {
    if (await reprojectAccess(companyId)) return true
  } catch (cause) {
    console.error('OwnershipTransferCard: access refresh failed', cause)
  }
  if (useStore.getState().activeCompanyId === companyId) {
    useStore.getState().setActiveCompany(null)
    useStore.getState().setNotice(m.settings_members_access_refresh_failed(), 'error')
  }
  return false
}

async function sendTransfer(
  companyId: string,
  targetUserId: string,
  confirmationId: string
): Promise<OwnershipTransferResult | null> {
  try {
    return await teamAccessApi.transferOwnership({
      companyId,
      targetUserId,
      confirmationId,
    })
  } catch (cause) {
    console.error('OwnershipTransferCard: transfer response was not received', cause)
    return null
  }
}

async function settleTransfer({
  queryClient,
  result,
  companyId,
  refreshAuth,
  setError,
}: {
  queryClient: QueryClient
  result: OwnershipTransferResult | null
  companyId: string
  refreshAuth: () => Promise<void>
  setError: (message: string | null) => void
}): Promise<void> {
  if (result?.kind === 'ok') {
    if (await reconcileCallerAccess(queryClient, companyId, refreshAuth)) {
      useStore.getState().setNotice(m.ownership_transfer_success())
    }
    return
  }
  if (result === null || result.kind === 'unknown' || result.kind === 'invalid') {
    setError(m.ownership_transfer_uncertain())
    await reconcileCallerAccess(queryClient, companyId, refreshAuth)
    return
  }
  setError(resolveRefusalMessage(result, m.ownership_transfer_operation_failed()))
}

function useTransferOperation({
  companyId,
  available,
  refreshAuth,
}: {
  companyId: string | null
  available: boolean
  refreshAuth: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const transfer = useCallback(
    async (targetUserId: string, confirmationId: string): Promise<void> => {
      if (!available || companyId === null || targetUserId === '' || lock.current) return
      lock.current = true
      setBusy(true)
      setError(null)
      try {
        const result = await sendTransfer(companyId, targetUserId, confirmationId)
        await settleTransfer({ queryClient, result, companyId, refreshAuth, setError })
      } finally {
        lock.current = false
        setBusy(false)
      }
    },
    [companyId, available, refreshAuth, queryClient]
  )
  return { busy, error, transfer }
}

/** Reads current eligible Admins and performs one immediate ownership transfer. */
export function useOwnershipTransfer(
  companyId: string | null,
  refreshAuth: () => Promise<void>
): OwnershipTransferViewModel {
  const { user } = useAuth()
  const mayTransfer = useCan('ownership:transfer')
  const permissionStatus = usePermissionStatus()
  const masquerade = useStore((state) => state.masquerade)
  const scope = useQueryScope()
  const available =
    user !== null &&
    mayTransfer &&
    permissionStatus === 'resolved' &&
    masquerade.kind === 'inactive'
  const directory = useOwnerDirectory({
    companyId,
    available,
    scope,
    userId: user?.id ?? null,
  })
  const operation = useTransferOperation({ companyId, available, refreshAuth })

  return {
    available,
    loading: directory.loading,
    directoryLoaded: directory.loaded,
    candidates: directory.candidates,
    busy: operation.busy,
    error: operation.error ?? directory.error,
    refresh: directory.refresh,
    transfer: operation.transfer,
  }
}
