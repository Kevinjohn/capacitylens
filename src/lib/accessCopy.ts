import type { Role } from '@capacitylens/shared/domain/access'
import { m } from '@/i18n'

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
