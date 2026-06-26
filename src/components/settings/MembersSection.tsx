import { useCallback, useEffect, useState } from 'react'
import { API_BASE, isServerConfigured } from '../../data/apiConfig'
import { useAuth } from '../../auth/authContext'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { Button, FieldError, SelectField } from '../common/ui'
import {
  canManageMemberRole,
  canRemoveMember,
  type Role,
} from '@capacitylens/shared/domain/access'

// Member-management section (P1.11), shown in Settings ONLY on an auth-enabled, server-backed deploy.
// Owner/Admin list members, change a member's role, revoke a member, and list/revoke outstanding
// invites + mint a new invite (link + optional email-preauth, reusing POST /api/invites). The CLIENT
// gate is courtesy only — the SAME pure guards (canManageMemberRole / canRemoveMember) hide controls
// the user can't use, but the SERVER is the backstop (every route is gated server-side; a 403 on the
// initial members fetch is what hides the whole section for a viewer/editor). The invite TOKEN is
// shown exactly ONCE, straight from the create response — it is write-once and never read back.

interface Member {
  userId: string
  role: Role
  status: string
  createdAt: string
  name: string | null
  email: string | null
  isSelf: boolean
}

interface InviteSummary {
  id: string
  role: Role
  preauthEmail: string | null
  expiresAt: string
  usedAt: string | null
  createdAt: string
}

const ALL_ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
]

// Role options offered to the actor: the `owner` option is present ONLY for an owner (an admin must
// never be offered to grant/assign owner — the pure guards reject it, but hiding it keeps the UI
// honest). Mirrors the server's owner-grant guard.
function roleOptions(myRole: Role | undefined): { value: Role; label: string }[] {
  if (myRole === 'owner') return ALL_ROLE_OPTIONS
  return ALL_ROLE_OPTIONS.filter((o) => o.value !== 'owner')
}

function labelFor(m: Member): string {
  const name = m.name?.trim()
  if (name && m.email) return `${name} (${m.email})`
  return name || m.email || m.userId
}

/**
 * The Settings → Members section (P1.11). Renders ONLY in server + auth-on mode; a 403 on the initial
 * members read self-gates it away for a viewer/editor (renders nothing). Owner/Admin affordances are
 * gated client-side via the shared pure guards (owner-only options hidden for an admin; an owner row
 * is read-only for an admin; the sole owner is protected). The server enforces all of it regardless.
 */
export function MembersSection() {
  const { authMode } = useAuth()
  const activeAccountId = useStore((s) => s.activeAccountId)
  const setNotice = useStore((s) => s.setNotice)
  const { error, errorField, errorId, fail } = useFieldError()

  const [members, setMembers] = useState<Member[] | null>(null)
  const [invites, setInvites] = useState<InviteSummary[]>([])
  // null = still loading / not yet decided; 'hidden' = a 403 self-gated us out (render nothing).
  const [gate, setGate] = useState<'loading' | 'shown' | 'hidden'>('loading')

  const [inviteRole, setInviteRole] = useState<Role>('editor')
  const [invitePreauth, setInvitePreauth] = useState('')
  // The freshly-minted link, shown ONCE after a successful create (the token is write-once).
  const [mintedLink, setMintedLink] = useState<string | null>(null)
  // Bumped after every mutation to re-run the fetch effect (a re-read keeps the list authoritative).
  const [reloadKey, setReloadKey] = useState(0)

  const enabled = authMode !== 'off' && isServerConfigured()
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  // Fetch (and re-fetch on reloadKey) the members + invites. The setState calls live inside the async
  // IIFE — behind an `await` — never synchronously in the effect body (the InviteAccept idiom), so
  // there's no cascading-render setState-in-effect. A 403 on the members read self-gates the section.
  useEffect(() => {
    if (!enabled || !activeAccountId) return
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/accounts/${activeAccountId}/members`, {
          credentials: 'include',
        })
        if (res.status === 403) {
          setGate('hidden') // a viewer/editor (or non-member) — hide the whole section.
          return
        }
        if (!res.ok) {
          setGate('shown')
          fail(null, `Could not load members (${res.status}).`)
          return
        }
        const body = (await res.json()) as { members: Member[] }
        setMembers(body.members)
        setGate('shown')
        // Invites are a separate, also-gated read; failure there is non-fatal to the member list.
        const invRes = await fetch(`${API_BASE}/api/accounts/${activeAccountId}/invites`, {
          credentials: 'include',
        })
        if (invRes.ok) setInvites(((await invRes.json()) as { invites: InviteSummary[] }).invites)
      } catch (e) {
        // A transport error (server down/offline) — surface it; do not swallow.
        setGate('shown')
        fail(null, `Could not reach the server: ${errorMessage(e)}`)
      }
    })()
  }, [enabled, activeAccountId, reloadKey, fail])

  if (!enabled) return null // OFF / local mode: the section does not exist.
  if (gate === 'hidden') return null // a 403 self-gated us out (viewer/editor/non-member).

  const myRole = members?.find((m) => m.isSelf)?.role
  const ownerCount = members?.filter((m) => m.role === 'owner').length ?? 0

  const changeRole = async (m: Member, nextRole: Role) => {
    if (nextRole === m.role) return
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${activeAccountId}/members/${m.userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        fail(null, body.error ?? `Could not change role (${res.status}).`)
        return
      }
      setNotice('Role updated.')
      reload()
    } catch (e) {
      fail(null, `Could not reach the server: ${errorMessage(e)}`)
    }
  }

  const removeMember = async (m: Member) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${activeAccountId}/members/${m.userId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        fail(null, body.error ?? `Could not remove member (${res.status}).`)
        return
      }
      setNotice('Member removed.')
      reload()
    } catch (e) {
      fail(null, `Could not reach the server: ${errorMessage(e)}`)
    }
  }

  const submitInvite = async () => {
    setMintedLink(null)
    const trimmed = invitePreauth.trim()
    try {
      const res = await fetch(`${API_BASE}/api/invites`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: activeAccountId,
          role: inviteRole,
          ...(trimmed ? { preauthEmail: trimmed } : {}),
        }),
      })
      if (res.status !== 201) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        fail('invite', body.error ?? `Could not create invite (${res.status}).`)
        return
      }
      const body = (await res.json()) as { token: string }
      // The token is write-once: build + show the link straight from this response and never again.
      setMintedLink(`${window.location.origin}/invite/${body.token}`)
      setInvitePreauth('')
      setNotice('Invite created.')
      reload()
    } catch (e) {
      fail('invite', `Could not reach the server: ${errorMessage(e)}`)
    }
  }

  const revokeInvite = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${activeAccountId}/invites/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 204) {
        fail(null, `Could not revoke invite (${res.status}).`)
        return
      }
      setNotice('Invite revoked.')
      reload()
    } catch (e) {
      fail(null, `Could not reach the server: ${errorMessage(e)}`)
    }
  }

  const copyLink = (link: string) => {
    void navigator.clipboard?.writeText(link).then(
      () => setNotice('Invite link copied.'),
      () => setNotice('Could not copy — select and copy the link manually.', 'error'),
    )
  }

  return (
    <section className="rounded border border-line bg-surface p-4" data-testid="members-section">
      <h2 className="mb-1 text-sm font-semibold text-ink">Members</h2>
      <p className="mb-3 text-xs text-muted">
        Manage who can access this company. Invite people, change a member's role, or remove them.
      </p>

      <FieldError id={errorId}>{errorField === null ? error : null}</FieldError>

      {/* Members list */}
      <div className="mb-4 divide-y divide-line">
        {members && members.length === 0 && (
          <p className="py-2 text-sm text-muted">No members yet.</p>
        )}
        {members?.map((m) => {
          // "May the actor touch this row's role at all?" — canManageMemberRole gates per
          // (actor,target,next); a row is editable iff the actor may set it to ANY non-current role
          // they'd be offered. The owner option is hidden for an admin (roleOptions), so the relevant
          // question is "may the actor manage this target": admin+ AND (target not owner OR actor owner).
          // We ask canManageMemberRole with a representative next-role to reuse the single-sourced guard.
          const mayTouch = !!myRole && canManageMemberRole(myRole, m.role, m.role === 'owner' ? 'admin' : 'editor')
          const isSoleOwner = m.role === 'owner' && ownerCount <= 1
          const mayRemove = !!myRole && canRemoveMember(myRole, m.role) && !isSoleOwner
          // Demote of the sole owner is also blocked client-side (mirror the server last-owner rule).
          const roleSelectDisabled = isSoleOwner
          return (
            <div
              key={m.userId}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
              data-testid="member-row"
            >
              <div className="min-w-0">
                <span className="text-sm text-ink">{labelFor(m)}</span>
                {m.isSelf && <span className="ml-1 text-xs text-muted">(you)</span>}
                <span className="ml-2 text-xs text-muted">· {m.status}</span>
              </div>
              <div className="flex items-center gap-2">
                {mayTouch ? (
                  <span data-testid="member-role-select">
                    <SelectField
                      // A generic accessible name (not the member's email) keeps the SelectField's own
                      // FieldLabel from duplicating the row's name text; the row scopes which member.
                      label="Member role"
                      value={m.role}
                      onChange={(v) => void changeRole(m, v as Role)}
                      options={roleOptions(myRole)}
                      disabled={roleSelectDisabled}
                    />
                  </span>
                ) : (
                  <span className="text-sm capitalize text-muted">{m.role}</span>
                )}
                {mayRemove && (
                  <Button variant="danger" testId="member-remove" onClick={() => void removeMember(m)}>
                    Remove
                  </Button>
                )}
                {isSoleOwner && (
                  <span className="text-xs text-muted">Sole owner — protected</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Invite form */}
      <div className="mb-4 space-y-2 rounded border border-line p-3">
        <h3 className="text-xs font-semibold text-ink">Invite someone</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-32">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">Role</span>
              <select
                data-testid="invite-role"
                aria-label="Invite role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {roleOptions(myRole).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="min-w-48 flex-1">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">Pre-authorise email (optional)</span>
              <input
                data-testid="invite-preauth"
                aria-label="Pre-authorise email"
                type="email"
                value={invitePreauth}
                onChange={(e) => setInvitePreauth(e.target.value)}
                placeholder="name@example.com"
                className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
          </div>
          <Button testId="invite-submit" onClick={() => void submitInvite()}>
            Create invite
          </Button>
        </div>
        <FieldError id={errorId}>{errorField === 'invite' ? error : null}</FieldError>
        {mintedLink && (
          <div className="flex flex-wrap items-center gap-2 rounded bg-canvas p-2">
            <code data-testid="invite-link" className="min-w-0 flex-1 break-all text-xs text-ink">
              {mintedLink}
            </code>
            <Button variant="ghost" onClick={() => copyLink(mintedLink)}>
              Copy
            </Button>
          </div>
        )}
      </div>

      {/* Outstanding invites */}
      {invites.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold text-ink">Outstanding invites</h3>
          <div className="divide-y divide-line">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                data-testid="invite-row"
              >
                <span className="text-sm text-ink">
                  <span className="capitalize">{inv.role}</span>
                  {inv.preauthEmail ? ` · ${inv.preauthEmail}` : ' · link'}
                  {inv.usedAt ? ' · used' : ` · expires ${inv.expiresAt.slice(0, 10)}`}
                </span>
                <Button variant="ghost" testId="invite-revoke" onClick={() => void revokeInvite(inv.id)}>
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
