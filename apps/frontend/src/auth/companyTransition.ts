import type {
  ClientMasqueradeEndReason,
  MasqueradeStatus,
} from '@capacitylens/shared/domain/masquerade'
import { useStore } from '@/store/useStore'
import { masqueradeApi } from './masqueradeApi'

async function loadMasqueradeModel() {
  const { masqueradeModel } = await import('./masqueradeModelInstance')
  return masqueradeModel
}

/** The authenticated company-switch boundary. It ends any current read projection before the
 * persistence subscriber installs another company's set. */
export async function transitionCompany(companyId: string | null): Promise<boolean> {
  const model = await loadMasqueradeModel()
  return model.transitionCompany(companyId)
}

/** Start a server-backed read-only member projection through the lazily loaded transition owner. */
export async function startMasquerade(companyId: string, targetUserId: string): Promise<boolean> {
  const model = await loadMasqueradeModel()
  return model.start(companyId, targetUserId)
}

/** Adopt current server status without pulling the transition owner into the application entry chunk. */
export async function adoptMasqueradeStatus(
  status: MasqueradeStatus,
  isCurrent: () => boolean = () => true
): Promise<boolean> {
  const model = await loadMasqueradeModel()
  if (!isCurrent()) return false
  await model.adoptStatus(status)
  return true
}

/** Capture the current model projection before a status request can race a local transition. */
export async function captureMasqueradeStatusCheck(): Promise<() => boolean> {
  const model = await loadMasqueradeModel()
  return model.captureStatusReconciliation()
}

/** Refresh the authoritative mode at its fixed deadline or after explicit reconciliation. */
export async function reconcileMasqueradeStatus(): Promise<void> {
  const isCurrent = await captureMasqueradeStatusCheck()
  const status = await masqueradeApi.status(useStore.getState().activeCompanyId ?? undefined)
  await adoptMasqueradeStatus(status, isCurrent)
}

/** Retry the active read projection through the lazily loaded transition owner. */
export async function retryMasqueradeProjection(): Promise<boolean> {
  const model = await loadMasqueradeModel()
  return model.retryProjection()
}

/** End the active projection through the lazily loaded transition owner. */
export async function endMasquerade(
  reason: ClientMasqueradeEndReason = 'explicit',
  navigate?: (to: string) => void
): Promise<boolean> {
  const model = await loadMasqueradeModel()
  return model.end(reason, navigate)
}
