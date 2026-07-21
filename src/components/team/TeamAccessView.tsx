import { Link } from 'react-router-dom'
import { can, canSeePrivateNames, canSeeTimeOffNote, type Role } from '@capacitylens/shared/domain/access'
import { usePermissionStatus, useRole } from '../../auth/permissionContext'
import { useAuth } from '../../auth/authContext'
import { accessLabelFor, accessSummaryFor } from '../../lib/accessCopy'
import { accessExperienceFor } from '../../lib/accessMode'
import { useOfflineState } from '../../data/useOfflineState'
import { MembersSection } from '../settings/MembersSection'
import { Badge } from '../ui/badge'
import { Alert, AlertDescription } from '../ui/alert'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Icon } from '../common/Icon'
import { m } from '@/i18n'

interface Capability {
  label: string
  allowed: boolean
}

function capabilities(role: Role): Capability[] {
  return [
    { label: m.access_cap_view_schedule(), allowed: can(role, 'read') },
    { label: m.access_cap_edit_schedule(), allowed: can(role, 'write') },
    { label: m.access_cap_manage_team(), allowed: can(role, 'manageMembers') },
    { label: m.access_cap_timeoff_notes(), allowed: canSeeTimeOffNote(role) },
    { label: m.access_cap_private_names(), allowed: canSeePrivateNames(role) },
    { label: m.access_cap_transfer_owner(), allowed: can(role, 'transferOwnership') },
  ]
}

export function TeamAccessView() {
  const role = useRole()
  const permissionStatus = usePermissionStatus()
  const { authMode } = useAuth()
  const offline = useOfflineState()
  const accessExperience = accessExperienceFor(authMode)
  const authenticated = accessExperience === 'authenticated'
  const resolvedRole = authenticated && permissionStatus === 'resolved' ? role : null
  // A cached slice is always the Viewer projection, regardless of the last online role or whether
  // this is an auth-off installation. Never advertise live Owner/Open/Demo powers while writes are
  // deliberately disabled and the server cannot confirm membership.
  const effectiveRole: Role | null = offline.readOnly ? 'viewer' : resolvedRole
  const mayManage = !offline.readOnly && resolvedRole !== null && can(resolvedRole, 'manageMembers')
  const accessCopyInput = {
    offlineReadOnly: offline.readOnly,
    experience: accessExperience,
    permissionStatus,
    role: resolvedRole,
  }
  const accessLabel = accessLabelFor(accessCopyInput)
  const accessSummary = accessSummaryFor(accessCopyInput)
  const accessWarning = offline.readOnly
    ? null
    : accessExperience === 'demo'
      ? m.access_demo_warning()
      : accessExperience === 'open'
        ? m.access_open_warning()
        : null

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">{m.access_title()}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{m.access_intro()}</p>
      </header>

      <Card data-testid="current-access">
        <CardHeader>
          <CardTitle><h2>{m.access_current_heading()}</h2></CardTitle>
          <CardDescription>{accessSummary}</CardDescription>
          <CardAction>
          <Badge variant={effectiveRole === 'viewer' || !effectiveRole ? 'outline' : 'default'}>
            {accessLabel}
          </Badge>
          </CardAction>
        </CardHeader>

        <CardContent>
        {effectiveRole ? (
          <ul className="grid gap-2 sm:grid-cols-2" aria-label={m.access_capabilities_label()}>
            {capabilities(effectiveRole).map((capability) => (
              <li key={capability.label} className="flex items-center gap-2 text-sm text-ink">
                <Icon
                  name={capability.allowed ? 'check' : 'close'}
                  className={capability.allowed ? 'text-brand' : 'text-muted'}
                />
                <span className="sr-only">
                  {capability.allowed ? m.access_cap_allowed() : m.access_cap_not_allowed()}
                </span>
                <span className={capability.allowed ? undefined : 'text-muted'}>{capability.label}</span>
              </li>
            ))}
          </ul>
        ) : accessWarning ? (
          <Alert>
            <AlertDescription>{accessWarning}</AlertDescription>
          </Alert>
        ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle><h2>{m.access_members_heading()}</h2></CardTitle>
            <CardDescription>{m.access_members_explainer()}</CardDescription>
          </CardHeader>
          {!authenticated && <CardContent className="text-xs font-medium text-muted">{m.access_members_demo_note()}</CardContent>}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle><h2>{m.access_resources_heading()}</h2></CardTitle>
            <CardDescription>{m.access_resources_explainer()}</CardDescription>
          </CardHeader>
          <CardContent>
          <Link to="/resources" className="mt-3 inline-block text-sm font-medium text-brand underline-offset-2 hover:underline">
            {m.access_open_resources()}
          </Link>
          </CardContent>
        </Card>
      </div>

      {/* Keep the write-once link state mounted across a fail-closed membership recheck. The wrapper
          hides stale management controls immediately; MembersSection independently self-gates its
          reads with the server and therefore remains safe for lower roles. */}
      {authenticated && (
        <div hidden={!mayManage}>
          <MembersSection />
        </div>
      )}
      {authenticated && !offline.readOnly && permissionStatus === 'resolved' && !mayManage ? (
        <Card>
          <CardHeader>
            <CardTitle><h2>{m.access_management_heading()}</h2></CardTitle>
            <CardDescription>{m.access_management_restricted()}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  )
}
