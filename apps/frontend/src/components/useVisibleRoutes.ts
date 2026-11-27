import { useMemo } from 'react'
import type { Role } from '@capacitylens/shared/domain/access'
import type { CapacityOverviewAccess } from '@capacitylens/shared/types/entities'
import { resolveCapacityOverviewAccessDecision } from '@/auth/capacityOverviewAccess'
import { usePermissionStatus, useRole } from '@/auth/permissionContext'
import type { PermissionContextValue } from '@/auth/permissionContext'
import { listVisibleRoutes } from '@/lib/navLinks'
import type { AppRouteDefinition, RouteVisibilityFacts } from '@/lib/navLinks'
import { hasDisciplinesEnabled, resolveCapacityOverviewAccess } from '@/store/selectors'
import { useStore } from '@/store/useStore'
import { resolveDiagnosticsAccessDecision } from './diagnostics/useDiagnosticsAccessDecision'

interface RouteVisibilityInput {
  role: Role | null
  status: NonNullable<PermissionContextValue['status']>
  capacityOverviewAccess: CapacityOverviewAccess
  disciplinesEnabled: boolean
}

/** Builds the route visibility context from the member's role and the company's settings. */
export function buildRouteVisibilityFacts({
  role,
  status,
  capacityOverviewAccess,
  disciplinesEnabled,
}: RouteVisibilityInput): RouteVisibilityFacts {
  return {
    disciplinesEnabled,
    capacityOverviewAllowed:
      resolveCapacityOverviewAccessDecision({ role, status, access: capacityOverviewAccess }) ===
      'allowed',
    diagnosticsAllowed: resolveDiagnosticsAccessDecision({ role, status }) === 'allowed',
  }
}

/** Lists the routes the current member is shown in the sidebar and the command palette. */
export function useVisibleRoutes(): AppRouteDefinition[] {
  const role = useRole()
  const status = usePermissionStatus()
  const capacityOverviewAccess = useStore((state) =>
    resolveCapacityOverviewAccess(state.data, state.activeCompanyId)
  )
  const disciplinesEnabled = useStore((state) =>
    hasDisciplinesEnabled(state.data, state.activeCompanyId)
  )
  const { capacityOverviewAllowed, diagnosticsAllowed } = buildRouteVisibilityFacts({
    role,
    status,
    capacityOverviewAccess,
    disciplinesEnabled,
  })
  return useMemo(
    () => listVisibleRoutes({ disciplinesEnabled, capacityOverviewAllowed, diagnosticsAllowed }),
    [disciplinesEnabled, capacityOverviewAllowed, diagnosticsAllowed]
  )
}
