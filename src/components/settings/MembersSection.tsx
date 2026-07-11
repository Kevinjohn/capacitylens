import { useCallback, useEffect, useState } from 'react'
import { API_BASE, isServerConfigured } from '../../data/apiConfig'
import { useAuth } from '../../auth/authContext'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { Button, FieldError, SelectField } from '../common/ui'
import { m } from '@/i18n'
import {
  canManageMemberRole,
  canRemoveMember,
  canResetMemberPassword,
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

// Each role's label is a GETTER (`() => m.key()`), not a pre-resolved string (the AppShell LINKS
// pattern, P1.5.2): this list is module-scope, so resolving `m.key()` here would freeze the label to
// the load-time locale. The getter defers it to render — roleOptions() calls each at its call site.
const ALL_ROLE_OPTIONS: { value: Role; label: () => string }[] = [
  { value: 'owner', label: () => m.settings_role_owner() },
  { value: 'admin', label: () => m.settings_role_admin() },
  { value: 'editor', label: () => m.settings_role_editor() },
  { value: 'viewer', label: () => m.settings_role_viewer() },
]

// Role options offered to the actor: the `owner` option is present ONLY for an owner (an admin must
// never be offered to grant/assign owner — the pure guards reject it, but hiding it keeps the UI
// honest). Mirrors the server's owner-grant guard. Labels are resolved here (render time, via the
// getters) so the returned options carry ready-to-render strings.
function roleOptions(myRole: Role | undefined): { value: Role; label: string }[] {
  const opts = myRole === 'owner' ? ALL_ROLE_OPTIONS : ALL_ROLE_OPTIONS.filter((o) => o.value !== 'owner')
  return opts.map((o) => ({ value: o.value, label: o.label() }))
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
  // 'loading' = still loading / not yet decided; 'shown' = render the section; 'hidden' = a 403
  // self-gated us out (render nothing).
  const [gate, setGate] = useState<'loading' | 'shown' | 'hidden'>('loading')

  const [inviteRole, setInviteRole] = useState<Role>('editor')
  const [invitePreauth, setInvitePreauth] = useState('')
  // The freshly-minted link, shown ONCE after a successful create (the token is write-once).
  const [mintedLink, setMintedLink] = useState<string | null>(null)
  // The freshly-minted password-reset link (P1.18) — same write-once posture as the invite link,
  // labelled with WHO it resets so an admin juggling several members can't hand out the wrong one.
  const [resetLink, setResetLink] = useState<{ link: string; member: string; expiresAt: string } | null>(null)
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
          fail(null, m.settings_members_err_load({ status: res.status }))
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
        fail(null, m.settings_err_server({ error: errorMessage(e) }))
      }
    })()
  }, [enabled, activeAccountId, reloadKey, fail])

  if (!enabled) return null // OFF / demo build: the section does not exist.
  if (gate === 'hidden') return null // a 403 self-gated us out (viewer/editor/non-member).

  const myRole = members?.find((m) => m.isSelf)?.role
  const ownerCount = members?.filter((m) => m.role === 'owner').length ?? 0

  // NB: the param is `mem`, NOT `m` — `m` is the imported i18n message catalogue (P1.5.2); a
  // `m: Member` param would shadow it and break the `m.settings_*()` calls in this scope.
  const changeRole = async (mem: Member, nextRole: Role) => {
    if (nextRole === mem.role) return
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${activeAccountId}/members/${mem.userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        fail(null, body.error ?? m.settings_members_err_change_role({ status: res.status }))
        return
      }
      setNotice(m.settings_members_role_updated())
      reload()
    } catch (e) {
      fail(null, m.settings_err_server({ error: errorMessage(e) }))
    }
  }

  // NB: the param is `mem`, NOT `m` — see changeRole above (`m` is the i18n catalogue, not a Member).
  const removeMember = async (mem: Member) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${activeAccountId}/members/${mem.userId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        fail(null, body.error ?? m.settings_members_err_remove({ status: res.status }))
        return
      }
      setNotice(m.settings_members_removed())
      reload()
    } catch (e) {
      fail(null, m.settings_err_server({ error: errorMessage(e) }))
    }
  }

  // Transfer ownership to `mem` and step the caller down to admin (server-atomic, owner-only). The
  // button is hidden unless the caller is the owner and `mem` is another, non-owner member. This is
  // consequential and NOT caller-reversible (you become admin — only the new owner can hand it back),
  // but it's immediate like removeMember above; the re-read reflects the new owner. `mem` is NOT `m`
  // (the i18n catalogue). The server (transferOwnership gate) is the real backstop; this is courtesy UI.
  const transferOwnership = async (mem: Member) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${activeAccountId}/transfer-ownership`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toUserId: mem.userId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        fail(null, body.error ?? m.settings_members_err_transfer({ status: res.status }))
        return
      }
      setNotice(m.settings_members_ownership_transferred())
      reload()
    } catch (e) {
      fail(null, m.settings_err_server({ error: errorMessage(e) }))
    }
  }

  // Mint a single-use password-reset link for `mem` (P1.18). Password mode only (the button is
  // hidden otherwise; the server 400s regardless). No email is ever sent — the admin copies the
  // link out of the write-once block below and hands it over directly. `mem` is NOT `m` (i18n).
  const resetPassword = async (mem: Member) => {
    setResetLink(null)
    try {
      const res = await fetch(
        `${API_BASE}/api/accounts/${activeAccountId}/members/${mem.userId}/reset-password`,
        { method: 'POST', credentials: 'include' },
      )
      if (res.status !== 201) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        fail(null, body.error ?? m.settings_members_err_reset({ status: res.status }))
        return
      }
      const body = (await res.json()) as { token: string; expiresAt: string }
      // Write-once: build + show the link straight from this response and never again.
      setResetLink({
        link: `${window.location.origin}/reset-password/${body.token}`,
        member: labelFor(mem),
        expiresAt: body.expiresAt,
      })
      setNotice(m.settings_members_reset_created())
    } catch (e) {
      fail(null, m.settings_err_server({ error: errorMessage(e) }))
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
        fail('invite', body.error ?? m.settings_members_err_create_invite({ status: res.status }))
        return
      }
      const body = (await res.json()) as { token: string }
      // The token is write-once: build + show the link straight from this response and never again.
      setMintedLink(`${window.location.origin}/invite/${body.token}`)
      setInvitePreauth('')
      setNotice(m.settings_members_invite_created())
      reload()
    } catch (e) {
      fail('invite', m.settings_err_server({ error: errorMessage(e) }))
    }
  }

  const revokeInvite = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${activeAccountId}/invites/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 204) {
        fail(null, m.settings_members_err_revoke_invite({ status: res.status }))
        return
      }
      setNotice(m.settings_members_invite_revoked())
      reload()
    } catch (e) {
      fail(null, m.settings_err_server({ error: errorMessage(e) }))
    }
  }

  const copyLink = (link: string, copiedNotice: string) => {
    void navigator.clipboard?.writeText(link).then(
      () => setNotice(copiedNotice),
      () => setNotice(m.settings_members_copy_failed(), 'error'),
    )
  }

  return (
    <section className="rounded border border-line bg-surface p-4" data-testid="members-section">
      <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_members_heading()}</h2>
      <p className="mb-3 text-xs text-muted">
        {m.settings_members_intro()}
      </p>

      <FieldError id={errorId}>{errorField === null ? error : null}</FieldError>

      {/* Members list */}
      <div className="mb-4 divide-y divide-line">
        {members && members.length === 0 && (
          <p className="py-2 text-sm text-muted">{m.settings_members_empty()}</p>
        )}
        {members?.map((mem) => {
          // NB: the row var is `mem`, NOT `m` — `m` is the imported i18n message catalogue (P1.5.2);
          // shadowing it here would make `m.settings_*()` resolve against the Member object instead.
          // "May the actor touch this row's role at all?" — canManageMemberRole gates per
          // (actor,target,next); a row is editable iff the actor may set it to ANY non-current role
          // they'd be offered. The owner option is hidden for an admin (roleOptions), so the relevant
          // question is "may the actor manage this target": admin+ AND (target not owner OR actor owner).
          // We ask canManageMemberRole with a representative next-role to reuse the single-sourced guard.
          const mayTouch = !!myRole && canManageMemberRole(myRole, mem.role, mem.role === 'owner' ? 'admin' : 'editor')
          const isSoleOwner = mem.role === 'owner' && ownerCount <= 1
          const mayRemove = !!myRole && canRemoveMember(myRole, mem.role) && !isSoleOwner
          // Reset links exist only in PASSWORD mode ('sso' delegates credentials to the IdP; the
          // server 400s there regardless). Same pure guard the server enforces: an admin must never
          // mint a reset link for an owner — a reset link is an account-takeover capability.
          const mayReset = authMode === 'password' && !!myRole && canResetMemberPassword(myRole, mem.role)
          // Demote of the sole owner is also blocked client-side (mirror the server last-owner rule).
          const roleSelectDisabled = isSoleOwner
          return (
            <div
              key={mem.userId}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
              data-testid="member-row"
            >
              <div className="min-w-0">
                <span className="text-sm text-ink">{labelFor(mem)}</span>
                {mem.isSelf && <span className="ml-1 text-xs text-muted">{m.settings_member_you()}</span>}
                <span className="ml-2 text-xs text-muted">· {mem.status}</span>
              </div>
              <div className="flex items-center gap-2">
                {mayTouch ? (
                  <span data-testid="member-role-select">
                    <SelectField
                      // A generic accessible name (not the member's email) keeps the SelectField's own
                      // FieldLabel from duplicating the row's name text; the row scopes which member.
                      label={m.settings_member_role_label()}
                      value={mem.role}
                      onChange={(v) => void changeRole(mem, v as Role)}
                      options={roleOptions(myRole)}
                      disabled={roleSelectDisabled}
                    />
                  </span>
                ) : (
                  <span className="text-sm capitalize text-muted">{mem.role}</span>
                )}
                {mayReset && (
                  <Button variant="ghost" testId="member-reset-password" onClick={() => void resetPassword(mem)}>
                    {m.settings_member_reset_password()}
                  </Button>
                )}
                {mayRemove && (
                  <Button variant="danger" testId="member-remove" onClick={() => void removeMember(mem)}>
                    {m.settings_member_remove()}
                  </Button>
                )}
                {/* Owner-only, non-self, non-owner target: the true atomic hand-over (promote them +
                    demote me), distinct from the change-role dropdown's promote-to-owner (which keeps
                    the caller an owner too). Hidden for everyone else; the server gate is the backstop. */}
                {myRole === 'owner' && !mem.isSelf && mem.role !== 'owner' && (
                  <Button variant="ghost" testId="member-make-owner" onClick={() => void transferOwnership(mem)}>
                    {m.settings_member_make_owner()}
                  </Button>
                )}
                {isSoleOwner && (
                  <span className="text-xs text-muted">{m.settings_member_sole_owner_protected()}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Freshly-minted password-reset link (P1.18) — write-once, same posture as the invite link
          below: shown straight from the create response and never read back. Named + dated so the
          admin hands the right link to the right person before it disappears. */}
      {resetLink && (
        <div className="mb-4 space-y-2 rounded bg-canvas p-2">
          <p className="text-xs text-muted">
            {m.settings_members_reset_intro({
              member: resetLink.member,
              // Local date + TIME, not a bare UTC .slice(0,10): the link lives only 24h, so a
              // date-only string (and a UTC one at that) misleads by up to a day in non-UTC zones
              // and hides the hour it dies. toLocaleString renders the viewer's wall clock.
              when: new Date(resetLink.expiresAt).toLocaleString(),
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code data-testid="reset-link" className="min-w-0 flex-1 break-all text-xs text-ink">
              {resetLink.link}
            </code>
            <Button variant="ghost" onClick={() => copyLink(resetLink.link, m.settings_members_reset_copied())}>
              {m.settings_invite_copy()}
            </Button>
          </div>
        </div>
      )}

      {/* Invite form */}
      <div className="mb-4 space-y-2 rounded border border-line p-3">
        <h3 className="text-xs font-semibold text-ink">{m.settings_invite_heading()}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-32">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">{m.settings_invite_role_label()}</span>
              <select
                data-testid="invite-role"
                aria-label={m.settings_invite_role_aria()}
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
              <span className="mb-1 block text-xs font-medium text-ink">{m.settings_invite_preauth_label()}</span>
              <input
                data-testid="invite-preauth"
                aria-label={m.settings_invite_preauth_aria()}
                type="email"
                value={invitePreauth}
                onChange={(e) => setInvitePreauth(e.target.value)}
                placeholder={m.settings_invite_preauth_placeholder()}
                className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
          </div>
          <Button testId="invite-submit" onClick={() => void submitInvite()}>
            {m.settings_invite_submit()}
          </Button>
        </div>
        <FieldError id={errorId}>{errorField === 'invite' ? error : null}</FieldError>
        {mintedLink && (
          <div className="flex flex-wrap items-center gap-2 rounded bg-canvas p-2">
            <code data-testid="invite-link" className="min-w-0 flex-1 break-all text-xs text-ink">
              {mintedLink}
            </code>
            <Button variant="ghost" onClick={() => copyLink(mintedLink, m.settings_members_invite_copied())}>
              {m.settings_invite_copy()}
            </Button>
          </div>
        )}
      </div>

      {/* Outstanding invites */}
      {invites.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold text-ink">{m.settings_invites_outstanding_heading()}</h3>
          <div className="divide-y divide-line">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                data-testid="invite-row"
              >
                <span className="text-sm text-ink">
                  <span className="capitalize">{inv.role}</span>
                  {inv.preauthEmail ? m.settings_invite_suffix_email({ email: inv.preauthEmail }) : m.settings_invite_suffix_link()}
                  {inv.usedAt ? m.settings_invite_suffix_used() : m.settings_invite_suffix_expires({ date: inv.expiresAt.slice(0, 10) })}
                </span>
                <Button variant="ghost" testId="invite-revoke" onClick={() => void revokeInvite(inv.id)}>
                  {m.settings_invite_revoke()}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
