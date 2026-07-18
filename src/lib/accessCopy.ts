import type { Role } from '@capacitylens/shared/domain/access'
import { m } from '@/i18n'
import type { AccessExperience } from './accessMode'

export type AccessPermissionStatus = 'not-applicable' | 'pending' | 'resolved' | 'unavailable'

export function roleLabel(role: Role): string {
  switch (role) {
    case 'owner': return m.settings_role_owner()
    case 'admin': return m.settings_role_admin()
    case 'editor': return m.settings_role_editor()
    case 'viewer': return m.settings_role_viewer()
  }
}

export function roleSummary(role: Role): string {
  switch (role) {
    case 'owner': return m.access_role_owner_summary()
    case 'admin': return m.access_role_admin_summary()
    case 'editor': return m.access_role_editor_summary()
    case 'viewer': return m.access_role_viewer_summary()
  }
}

interface AccessCopyInput {
  offlineReadOnly: boolean
  experience: AccessExperience
  permissionStatus: AccessPermissionStatus
  role: Role | null
}

/** Single product-facing label for demo, open, authenticated and cached-offline access. */
export function accessLabelFor(input: AccessCopyInput): string {
  if (input.offlineReadOnly) return m.access_offline_label()
  if (input.experience === 'demo') return m.access_demo_label()
  if (input.experience === 'open') return m.access_open_label()
  if (input.permissionStatus === 'pending') return m.access_checking_label()
  if (input.permissionStatus !== 'resolved' || input.role === null) return m.access_unavailable_label()
  return roleLabel(input.role)
}

/** Explanatory counterpart to {@link accessLabelFor}, with the identical state precedence. */
export function accessSummaryFor(input: AccessCopyInput): string {
  if (input.offlineReadOnly) return m.access_offline_summary()
  if (input.experience === 'demo') return m.access_demo_summary()
  if (input.experience === 'open') return m.access_open_summary()
  if (input.permissionStatus === 'pending') return m.access_checking_summary()
  if (input.permissionStatus !== 'resolved' || input.role === null) return m.access_unavailable_summary()
  return roleSummary(input.role)
}
