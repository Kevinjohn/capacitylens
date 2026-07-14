import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { API_BASE, isServerConfigured } from '../../data/apiConfig'
import { useAuth } from '../../auth/authContext'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { readApiError } from '../../lib/readApiError'
import { Button, FieldError, SelectField } from '../common/ui'
import { m } from '@/i18n'
import {
  canManageMemberRole,
  canRemoveMember,
  type Role,
} from '@capacitylens/shared/domain/access'
import { apiFetch } from '../../data/requestTimeout'
import { MAX_EMAIL_LENGTH } from '@capacitylens/shared/lib/strings'

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
  // Whether the actor may mint a password-reset link for this member — SERVER-computed (it folds in
  // the cross-account + self-exemption checks a per-account pure guard can't see, and is `false` in
  // SSO mode). Trusting the server here keeps the client button from drifting into offering a reset
  // the server will always 403 (e.g. a member who owns another account).
  mayResetPassword: boolean
}

interface InviteSummary {
  id: string
  role: Role
  preauthEmail: string | null
  expiresAt: string
  usedAt: string | null
  createdAt: string
}

const KNOWN_ROLES = new Set<Role>(['owner', 'admin', 'editor', 'viewer'])
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))

function parseMembers(value: unknown): Member[] | null {
  if (!isRecord(value) || !Array.isArray(value.members)) return null
  for (const row of value.members) {
    if (
      !isRecord(row) ||
      typeof row.userId !== 'string' || row.userId.length === 0 ||
      !KNOWN_ROLES.has(row.role as Role) ||
      row.status !== 'active' ||
      !isTimestamp(row.createdAt) ||
      !(row.name === null || typeof row.name === 'string') ||
      !(row.email === null || typeof row.email === 'string') ||
      typeof row.isSelf !== 'boolean' ||
      typeof row.mayResetPassword !== 'boolean'
    ) return null
  }
  return value.members as Member[]
}

function parseInvites(value: unknown): InviteSummary[] | null {
  if (!isRecord(value) || !Array.isArray(value.invites)) return null
  for (const row of value.invites) {
    if (
      !isRecord(row) ||
      typeof row.id !== 'string' || row.id.length === 0 ||
      !KNOWN_ROLES.has(row.role as Role) ||
      !(row.preauthEmail === null || typeof row.preauthEmail === 'string') ||
      !isTimestamp(row.expiresAt) ||
      !(row.usedAt === null || isTimestamp(row.usedAt)) ||
      !isTimestamp(row.createdAt)
    ) return null
  }
  return value.invites as InviteSummary[]
}

function parseTokenResponse(value: unknown): { token: string; expiresAt?: string } | null {
  if (!isRecord(value) || typeof value.token !== 'string' || value.token.length === 0) return null
  if (value.expiresAt !== undefined && !isTimestamp(value.expiresAt)) return null
  return { token: value.token, ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}) }
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
 * A write-once "here is a freshly-minted link, copy it now" block (shared by the invite link and the
 * password-reset link). Renders the `break-all` <code> + ghost copy Button once; the token behind the
 * link is never read back. Pass `intro` (a <p>) to prepend an explanatory line — the reset block uses
 * it to name WHO/when; the invite block omits it. Structure is intentionally two shapes (the intro
 * variant needs the outer `space-y-2` stack) so both call sites keep their exact prior markup.
 */
function CopyableLinkBlock({
  link,
  testId,
  copiedNotice,
  copyLink,
  intro,
}: {
  link: string
  testId: string
  copiedNotice: string
  copyLink: (link: string, copiedNotice: string) => void
  intro?: ReactNode
}) {
  const code = (
    <code data-testid={testId} className="min-w-0 flex-1 break-all text-xs text-ink">
      {link}
    </code>
  )
  const button = (
    <Button variant="ghost" onClick={() => copyLink(link, copiedNotice)}>
      {m.settings_invite_copy()}
    </Button>
  )
  if (intro) {
    return (
      <div className="mb-4 space-y-2 rounded bg-canvas p-2">
        {intro}
        <div className="flex flex-wrap items-center gap-2">
          {code}
          {button}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded bg-canvas p-2">
      {code}
      {button}
    </div>
  )
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
  // `userId` is carried (not just the display label) so a membership write that burns this member's
  // token server-side can clear the block — see the changeRole / transferOwnership clears below.
  const [resetLink, setResetLink] = useState<
    { userId: string; link: string; member: string; expiresAt: string } | null
  >(null)
  // Bumped after every mutation to re-run the fetch effect (a re-read keeps the list authoritative).
  const [reloadKey, setReloadKey] = useState(0)
  const requestGeneration = useRef(0)
  const actionLock = useRef<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const enabled = authMode !== 'off' && isServerConfigured()
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const beginAction = (key: string): boolean => {
    if (actionLock.current !== null) return false
    actionLock.current = key
    setBusyAction(key)
    return true
  }
  const endAction = () => {
    actionLock.current = null
    setBusyAction(null)
  }

  // Fetch (and re-fetch on reloadKey) the members + invites. The setState calls live inside the async
  // IIFE — behind an `await` — never synchronously in the effect body (the InviteAccept idiom), so
  // there's no cascading-render setState-in-effect. A 403 on the members read self-gates the section.
  useEffect(() => {
    if (!enabled || !activeAccountId) return
    const generation = ++requestGeneration.current
    let cancelled = false
    const current = () => !cancelled && requestGeneration.current === generation
    void (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/accounts/${activeAccountId}/members`, {
          credentials: 'include',
        })
        if (res.status === 403) {
          if (!current()) return
          setGate('hidden') // a viewer/editor (or non-member) — hide the whole section.
          return
        }
        if (!res.ok) {
          if (!current()) return
          setGate('shown')
          fail(null, m.settings_members_err_load({ status: res.status }))
          return
        }
        const membersBody = parseMembers(await res.json())
        if (!current()) return
        if (!membersBody) throw new Error('The server returned an invalid members response.')
        setMembers(membersBody)
        setGate('shown')
        // Invites are a separate, also-gated read; failure there is non-fatal to the member list.
        const invRes = await apiFetch(`${API_BASE}/api/accounts/${activeAccountId}/invites`, {
          credentials: 'include',
        })
        if (!invRes.ok) {
          if (!current()) return
          const message = (await readApiError(invRes)) ?? m.settings_members_err_load({ status: invRes.status })
          if (!current()) return
          fail(null, message)
          return
        }
        const invitesBody = parseInvites(await invRes.json())
        if (!current()) return
        if (!invitesBody) throw new Error('The server returned an invalid invites response.')
        setInvites(invitesBody)
      } catch (e) {
        if (!current()) return
        // A transport error (server down/offline) — surface it; do not swallow.
        setGate('shown')
        fail(null, m.settings_err_server({ error: errorMessage(e) }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, activeAccountId, reloadKey, fail])

  if (!enabled) return null // OFF / demo build: the section does not exist.
  if (gate === 'hidden') return null // a 403 self-gated us out (viewer/editor/non-member).

  const myRole = members?.find((m) => m.isSelf)?.role
  const ownerCount = members?.filter((m) => m.role === 'owner').length ?? 0

  // NB: the param is `mem`, NOT `m` — `m` is the imported i18n message catalogue (P1.5.2); a
  // `m: Member` param would shadow it and break the `m.settings_*()` calls in this scope.
  const changeRole = async (mem: Member, nextRole: Role) => {
    if (nextRole === mem.role) return
    if (!beginAction(`role:${mem.userId}`)) return
    try {
      const res = await apiFetch(`${API_BASE}/api/accounts/${activeAccountId}/members/${mem.userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      })
      if (!res.ok) {
        fail(null, (await readApiError(res)) ?? m.settings_members_err_change_role({ status: res.status }))
        return
      }
      setNotice(m.settings_members_role_updated())
      // The write-once block must never keep displaying a link the server has already revoked:
      // upsertMember burns THIS member's outstanding reset tokens on every membership write (the
      // P1.18 TOCTOU close), so a role change to the shown member kills that link server-side.
      if (resetLink?.userId === mem.userId) setResetLink(null)
      reload()
    } catch (e) {
      fail(null, m.settings_err_server({ error: errorMessage(e) }))
    } finally {
      endAction()
    }
  }

  // NB: the param is `mem`, NOT `m` — see changeRole above (`m` is the i18n catalogue, not a Member).
  const removeMember = async (mem: Member) => {
    if (!beginAction(`remove:${mem.userId}`)) return
    try {
      const res = await apiFetch(`${API_BASE}/api/accounts/${activeAccountId}/members/${mem.userId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 204) {
        fail(null, (await readApiError(res)) ?? m.settings_members_err_remove({ status: res.status }))
        return
      }
      setNotice(m.settings_members_removed())
      reload()
    } catch (e) {
      fail(null, m.settings_err_server({ error: errorMessage(e) }))
    } finally {
      endAction()
    }
  }

  // Transfer ownership to `mem` and step the caller down to admin (server-atomic, owner-only). The
  // button is hidden unless the caller is the owner and `mem` is another, non-owner member. This is
  // consequential and NOT caller-reversible (you become admin — only the new owner can hand it back),
  // but it's immediate like removeMember above; the re-read reflects the new owner. `mem` is NOT `m`
  // (the i18n catalogue). The server (transferOwnership gate) is the real backstop; this is courtesy UI.
  const transferOwnership = async (mem: Member) => {
    if (!beginAction(`transfer:${mem.userId}`)) return
    try {
      const res = await apiFetch(`${API_BASE}/api/accounts/${activeAccountId}/transfer-ownership`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toUserId: mem.userId }),
      })
      if (!res.ok) {
        fail(null, (await readApiError(res)) ?? m.settings_members_err_transfer({ status: res.status }))
        return
      }
      setNotice(m.settings_members_ownership_transferred())
      // transferOwnership does TWO upserts in one tx — promoting `mem` AND demoting the caller — so
      // the server burns outstanding reset tokens for BOTH. Clear the write-once block if it shows a
      // link for either party, so we never hand out a link the server has already revoked (same
      // reason as the changeRole clear above). `mm` is NOT `m` (the i18n catalogue).
      const selfUserId = members?.find((mm) => mm.isSelf)?.userId
      if (resetLink && (resetLink.userId === mem.userId || resetLink.userId === selfUserId)) {
        setResetLink(null)
      }
      reload()
    } catch (e) {
      fail(null, m.settings_err_server({ error: errorMessage(e) }))
    } finally {
      endAction()
    }
  }

  // Mint a single-use password-reset link for `mem` (P1.18). Password mode only (the button is
  // hidden otherwise; the server 400s regardless). No email is ever sent — the admin copies the
  // link out of the write-once block below and hands it over directly. `mem` is NOT `m` (i18n).
  const resetPassword = async (mem: Member) => {
    if (!beginAction(`reset:${mem.userId}`)) return
    setResetLink(null)
    try {
      const res = await apiFetch(
        `${API_BASE}/api/accounts/${activeAccountId}/members/${mem.userId}/reset-password`,
        { method: 'POST', credentials: 'include' },
      )
      if (res.status !== 201) {
        fail(null, (await readApiError(res)) ?? m.settings_members_err_reset({ status: res.status }))
        return
      }
      const body = parseTokenResponse(await res.json())
      if (!body?.expiresAt) {
        fail(null, m.settings_members_err_reset({ status: res.status }))
        return
      }
      // Write-once: build + show the link straight from this response and never again. `userId` is
      // carried so a later membership write on this member can clear the stale block (see the
      // changeRole / transferOwnership clears above).
      setResetLink({
        userId: mem.userId,
        link: `${window.location.origin}/reset-password/${body.token}`,
        member: labelFor(mem),
        expiresAt: body.expiresAt,
      })
      setNotice(m.settings_members_reset_created())
    } catch (e) {
      fail(null, m.settings_err_server({ error: errorMessage(e) }))
    } finally {
      endAction()
    }
  }

  const submitInvite = async () => {
    setMintedLink(null)
    const trimmed = invitePreauth.trim()
    if (trimmed.length > MAX_EMAIL_LENGTH || (trimmed.length > 0 && !/^[^@\s]+@[^@\s]+$/.test(trimmed))) {
      fail('invite', m.identity_err_email())
      return
    }
    if (!beginAction('invite:create')) return
    try {
      const res = await apiFetch(`${API_BASE}/api/invites`, {
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
        fail('invite', (await readApiError(res)) ?? m.settings_members_err_create_invite({ status: res.status }))
        return
      }
      const body = parseTokenResponse(await res.json())
      if (!body) {
        fail('invite', m.settings_members_err_create_invite({ status: res.status }))
        return
      }
      // The token is write-once: build + show the link straight from this response and never again.
      setMintedLink(`${window.location.origin}/invite/${body.token}`)
      setInvitePreauth('')
      setNotice(m.settings_members_invite_created())
      reload()
    } catch (e) {
      fail('invite', m.settings_err_server({ error: errorMessage(e) }))
    } finally {
      endAction()
    }
  }

  const revokeInvite = async (id: string) => {
    if (!beginAction(`invite:revoke:${id}`)) return
    try {
      const res = await apiFetch(`${API_BASE}/api/accounts/${activeAccountId}/invites/${id}`, {
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
    } finally {
      endAction()
    }
  }

  const copyLink = (link: string, copiedNotice: string) => {
    // navigator.clipboard is undefined in insecure contexts (plain-HTTP self-hosts, some
    // WebViews). An optional chain there would short-circuit past BOTH .then callbacks —
    // a click that silently does nothing (the swallow DEFENSIVE-CODING.md forbids). Surface
    // the same failure notice instead; its wording already tells the user the manual fallback.
    if (!navigator.clipboard) {
      setNotice(m.settings_members_copy_failed(), 'error')
      return
    }
    void navigator.clipboard.writeText(link).then(
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
          // server 400s there regardless) and never for a target an admin can't touch (e.g. an owner,
          // or a member who owns another account — a reset link is an account-takeover capability).
          // We trust the SERVER-computed `mayResetPassword`: it already folds in the cross-account +
          // self-exemption checks the per-account pure guard can't see AND returns `false` in SSO mode,
          // so the old `authMode === 'password'` / `myRole` conditions here would be redundant.
          const mayReset = mem.mayResetPassword
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
                      disabled={roleSelectDisabled || busyAction !== null}
                    />
                  </span>
                ) : (
                  <span className="text-sm capitalize text-muted">{mem.role}</span>
                )}
                {mayReset && (
                  <Button variant="ghost" testId="member-reset-password" disabled={busyAction !== null} onClick={() => void resetPassword(mem)}>
                    {m.settings_member_reset_password()}
                  </Button>
                )}
                {mayRemove && (
                  <Button variant="danger" testId="member-remove" disabled={busyAction !== null} onClick={() => void removeMember(mem)}>
                    {m.settings_member_remove()}
                  </Button>
                )}
                {/* Owner-only, non-self, non-owner target: the true atomic hand-over (promote them +
                    demote me), distinct from the change-role dropdown's promote-to-owner (which keeps
                    the caller an owner too). Hidden for everyone else; the server gate is the backstop. */}
                {myRole === 'owner' && !mem.isSelf && mem.role !== 'owner' && (
                  <Button variant="ghost" testId="member-make-owner" disabled={busyAction !== null} onClick={() => void transferOwnership(mem)}>
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
        <CopyableLinkBlock
          link={resetLink.link}
          testId="reset-link"
          copiedNotice={m.settings_members_reset_copied()}
          copyLink={copyLink}
          intro={
            <p className="text-xs text-muted">
              {m.settings_members_reset_intro({
                member: resetLink.member,
                // Local date + TIME, not a bare UTC .slice(0,10): the link lives only 24h, so a
                // date-only string (and a UTC one at that) misleads by up to a day in non-UTC zones
                // and hides the hour it dies. toLocaleString renders the viewer's wall clock.
                when: new Date(resetLink.expiresAt).toLocaleString(),
              })}
            </p>
          }
        />
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
                disabled={busyAction !== null}
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
                maxLength={MAX_EMAIL_LENGTH}
                onChange={(e) => setInvitePreauth(e.target.value)}
                disabled={busyAction !== null}
                placeholder={m.settings_invite_preauth_placeholder()}
                className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
          </div>
          <Button testId="invite-submit" disabled={busyAction !== null} onClick={() => void submitInvite()}>
            {m.settings_invite_submit()}
          </Button>
        </div>
        <FieldError id={errorId}>{errorField === 'invite' ? error : null}</FieldError>
        {mintedLink && (
          <CopyableLinkBlock
            link={mintedLink}
            testId="invite-link"
            copiedNotice={m.settings_members_invite_copied()}
            copyLink={copyLink}
          />
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
                <Button variant="ghost" testId="invite-revoke" disabled={busyAction !== null} onClick={() => void revokeInvite(inv.id)}>
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
