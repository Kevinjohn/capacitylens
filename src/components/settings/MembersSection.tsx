import { useCallback, useState, type ReactNode } from 'react'
import { isServerConfigured } from '../../data/apiConfig'
import { useAuth } from '../../auth/authContext'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { Button, ConfirmDialog, FieldError, SelectField } from '../common/ui'
import { m } from '@/i18n'
import {
  canManageMemberRole,
  canRemoveMember,
  type Role,
} from '@capacitylens/shared/domain/access'
import type { InvitationRole } from '@capacitylens/shared/account/types'
import {
  teamAccessClient,
  type TeamInvitation,
  type TeamMember,
} from '../../account/teamAccessClient'
import { MAX_EMAIL_LENGTH } from '@capacitylens/shared/lib/strings'
import { roleLabel, roleSummary } from '../../lib/accessCopy'
import { fetchAccountSummaries } from '../../auth/useAccountSummaries'
import { refreshActiveAccountSlice } from '../../data/persist'
import { offlineStateSnapshot } from '../../data/offlineCache'
import { useOfflineState } from '../../data/useOfflineState'
import { useTeamDirectory } from './useTeamDirectory'

// Member-management section shown in Team & access on an auth-enabled, server-backed deploy.
// Owner/Admin list members, change a member's role, revoke a member, and list/revoke outstanding
// invites + mint a new invite (link + optional email-preauth, reusing POST /api/invites). The CLIENT
// gate is courtesy only — the SAME pure guards (canManageMemberRole / canRemoveMember) hide controls
// the user can't use, but the SERVER is the backstop (every route is gated server-side; a 403 on the
// initial members fetch is what hides the whole section for a viewer/editor). The invite TOKEN is
// shown exactly ONCE, straight from the create response — it is write-once and never read back.

type Member = TeamMember

// Each role's label is a GETTER (`() => m.key()`), not a pre-resolved string (the AppShell LINKS
// pattern, P1.5.2): this list is module-scope, so resolving `m.key()` here would freeze the label to
// the load-time locale. The getter defers it to render — roleOptions() calls each at its call site.
const ALL_ROLE_OPTIONS: { value: Role; label: () => string }[] = [
  { value: 'admin', label: () => m.settings_role_admin() },
  { value: 'editor', label: () => m.settings_role_editor() },
  { value: 'viewer', label: () => m.settings_role_viewer() },
]

// Owner is deliberately absent: ownership can change only through the explicit atomic transfer.
// Labels are resolved at render time so a locale change is reflected without reloading the module.
function roleOptions(): { value: Role; label: string }[] {
  return ALL_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label() }))
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
 * variant needs an outer vertical stack) so both call sites keep their exact prior markup.
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
      <div className="mb-4 flex flex-col gap-2 rounded bg-canvas p-2">
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
 * The Team & access member-management section. Renders ONLY in server + auth-on mode; a 403 on the initial
 * members read self-gates it away for a viewer/editor (renders nothing). Owner/Admin affordances are
 * gated client-side via the shared pure guards (Owner actions hidden for an Admin; Owner membership
 * stays outside ordinary role/removal controls). The server enforces all of it regardless.
 */
export function MembersSection() {
  const activeAccountId = useStore((s) => s.activeAccountId)
  return (
    <AccountMembersSection
      key={activeAccountId ?? 'no-active-account'}
      activeAccountId={activeAccountId}
    />
  )
}

/** Account-keyed implementation. Changing companies remounts this boundary, which discards
 * account-local drafts, confirmations, action locks and write-once bearer links together. */
function AccountMembersSection({ activeAccountId }: { activeAccountId: string | null }) {
  const { authMode, refreshAuth } = useAuth()
  const offline = useOfflineState()
  const setActiveAccount = useStore((s) => s.setActiveAccount)
  const setAccountSummaries = useStore((s) => s.setAccountSummaries)
  const setNotice = useStore((s) => s.setNotice)
  const invalidateMemberships = useStore((s) => s.invalidateMemberships)
  const { error, errorField, errorId, fail } = useFieldError()

  const [inviteRole, setInviteRole] = useState<InvitationRole>('editor')
  const [invitePreauth, setInvitePreauth] = useState('')
  // The freshly-minted link, shown ONCE after a successful create (the token is write-once). Keep
  // its non-secret invite id so a revoke or authoritative list refresh can clear a now-dead link.
  const [mintedLink, setMintedLink] = useState<{ inviteId: string | null; link: string } | null>(null)
  // The freshly-minted password-reset link (P1.18) — same write-once posture as the invite link,
  // labelled with WHO it resets so an admin juggling several members can't hand out the wrong one.
  // `userId` is carried (not just the display label) so a membership write that burns this member's
  // token server-side can clear the block — see the changeRole / transferOwnership clears below.
  const [resetLink, setResetLink] = useState<
    { userId: string; link: string; member: string; expiresAt: string } | null
  >(null)
  const [transferTarget, setTransferTarget] = useState<Member | null>(null)
  const [roleChange, setRoleChange] = useState<{ member: Member; nextRole: Role } | null>(null)
  const reconcileMintedInvite = useCallback((nextInvites: TeamInvitation[]) => {
    setMintedLink((current) => (
      current?.inviteId &&
      !nextInvites.some((invite) => invite.id === current.inviteId && invite.usedAt === null)
        ? null
        : current
    ))
  }, [])

  const enabled = authMode !== 'off' && isServerConfigured()
  const {
    members,
    invites,
    replaceDirectory,
    gate,
    reload,
    busyAction,
    beginAction,
    endAction,
  } = useTeamDirectory({
    enabled,
    activeAccountId,
    offlineReadOnly: offline.readOnly,
    fail,
    onInvitesLoaded: reconcileMintedInvite,
  })
  const requestAccountId = (): string => {
    if (!activeAccountId) throw new Error('No active account is available for this account operation.')
    return activeAccountId
  }
  const isActiveAccount = (accountId: string): boolean => (
    useStore.getState().activeAccountId === accountId
  )
  const closeActiveAccount = (): void => {
    if (useStore.getState().activeAccountId !== activeAccountId) return
    setActiveAccount(null)
    // Membership loss is not an ordinary trip to the picker: do not offer a Back shortcut to a
    // company the caller can no longer open.
    useStore.setState({ previousAccountId: null })
  }

  /** Re-resolve every caller-owned projection after a possible self-role mutation. The role badge
   * and affordances fail closed immediately via membershipRevision; the tenant slice is then fetched
   * again under the new server role so confidential fields from the old projection cannot linger. */
  const refreshCallerAccess = async (knownRemoved = false): Promise<'active' | 'left' | 'failed'> => {
    const accountId = activeAccountId
    if (!accountId) return 'failed'
    invalidateMemberships()
    await refreshAuth()
    if (!isActiveAccount(accountId)) return 'left'
    const summaries = await fetchAccountSummaries({ allowCachedFallback: false })
    if (!isActiveAccount(accountId)) return 'left'
    // A cached fallback is useful for ordinary offline viewing but is not evidence of the caller's
    // post-mutation role. Fail closed instead of accepting a stale membership list as authority.
    if (summaries === null || offlineStateSnapshot().readOnly) {
      closeActiveAccount()
      setNotice(m.settings_members_access_refresh_failed(), 'error')
      return 'failed'
    }
    setAccountSummaries(summaries)
    const stillMember = !knownRemoved && summaries.some((account) => account.id === accountId)
    if (!stillMember) {
      closeActiveAccount()
      return 'left'
    }
    const outcome = await refreshActiveAccountSlice(accountId)
    if (!isActiveAccount(accountId)) return 'left'
    // `refreshActiveAccountSlice` can report `reloaded` after restoring an offline snapshot. That is
    // still not an authoritative post-role projection: close the tenant so confidential fields
    // from the caller's previous role cannot remain visible under an unverified role badge.
    if (outcome === 'reloaded' && !offlineStateSnapshot().readOnly) return 'active'
    // A user-initiated tenant switch can legitimately supersede this refresh. Never close the new
    // tenant or replace its notice because a stale operation finished late.
    closeActiveAccount()
    setNotice(m.settings_members_access_refresh_failed(), 'error')
    return 'failed'
  }

  const reconcileUnknownMutation = async (
    message: string,
    { callerAccessMayHaveChanged = false }: { callerAccessMayHaveChanged?: boolean } = {},
  ): Promise<void> => {
    const accountId = requestAccountId()
    if (!isActiveAccount(accountId)) return
    const accessResult = callerAccessMayHaveChanged ? await refreshCallerAccess() : null
    if (!isActiveAccount(accountId)) return
    if (accessResult === 'failed') return
    if (accessResult === 'left') {
      setNotice(`${message} Your company access was refreshed; verify the result before retrying.`, 'warning')
      return
    }
    try {
      const [memberResult, inviteResult] = await Promise.all([
        teamAccessClient.listMembers(accountId),
        teamAccessClient.listInvitations(accountId),
      ])
      if (!isActiveAccount(accountId)) return
      if (memberResult.kind !== 'ok' || inviteResult.kind !== 'ok') {
        throw new Error('The authoritative lists could not be reloaded.')
      }
      const nextMembers = memberResult.value
      const nextInvites = inviteResult.value
      replaceDirectory(nextMembers, nextInvites)
      setMintedLink((current) => (
        current?.inviteId &&
        !nextInvites.some((invite) => invite.id === current.inviteId && invite.usedAt === null)
          ? null
          : current
      ))
      setNotice(`${message} Memberships and invites were reloaded; verify the result before retrying.`, 'warning')
    } catch (reloadError) {
      if (!isActiveAccount(accountId)) return
      if (accessResult === 'active') {
        setNotice(`${message} Your access was refreshed; verify the result before retrying.`, 'warning')
      } else {
        fail(null, `${message} Reload the page before retrying. ${errorMessage(reloadError)}`)
      }
    }
  }


  if (!enabled) return null // OFF / demo build: the section does not exist.
  // Privileged controls stay fail-closed until the current account's members read authorizes this
  // section. A 403 remains hidden, and a switch cannot briefly expose the next account's form while
  // its authorization request is still pending.
  if (gate === 'loading' || gate === 'hidden') return null
  if (gate === 'error') {
    return (
      <section className="rounded border border-line bg-surface p-4" data-testid="members-section">
        <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_members_heading()}</h2>
        <FieldError id={errorId}>{error}</FieldError>
      </section>
    )
  }

  const myRole = members?.find((m) => m.isSelf)?.role
  // NB: the param is `mem`, NOT `m` — `m` is the imported i18n message catalogue (P1.5.2); a
  // `m: Member` param would shadow it and break the `m.settings_*()` calls in this scope.
  const changeRole = async (mem: Member, nextRole: Role) => {
    if (nextRole === mem.role) return
    const accountId = requestAccountId()
    if (!beginAction(`role:${mem.userId}`)) return
    try {
      const result = await teamAccessClient.changeMemberRole(accountId, mem.userId, nextRole)
      if (!isActiveAccount(accountId)) return
      if (result.kind !== 'ok') {
        if (result.kind === 'unknown') {
          await reconcileUnknownMutation(
            'The role change had an unknown outcome.',
            { callerAccessMayHaveChanged: mem.isSelf },
          )
          return
        }
        fail(null, result.kind === 'rejected' && result.message
          ? result.message
          : m.settings_members_err_change_role({ status: result.status }))
        return
      }
      setNotice(m.settings_members_role_updated())
      // The write-once block must never keep displaying a link the server has already revoked:
      // upsertMember burns THIS member's outstanding reset tokens on every membership write (the
      // P1.18 TOCTOU close), so a role change to the shown member kills that link server-side.
      if (resetLink?.userId === mem.userId) setResetLink(null)
      if (mem.isSelf) await refreshCallerAccess()
      reload()
    } catch (e) {
      await reconcileUnknownMutation(
        `The role change had an unknown outcome. ${errorMessage(e)}`,
        { callerAccessMayHaveChanged: mem.isSelf },
      )
    } finally {
      endAction()
    }
  }

  // NB: the param is `mem`, NOT `m` — see changeRole above (`m` is the i18n catalogue, not a Member).
  const removeMember = async (mem: Member) => {
    const accountId = requestAccountId()
    if (!beginAction(`remove:${mem.userId}`)) return
    try {
      const result = await teamAccessClient.removeMember(accountId, mem.userId)
      if (!isActiveAccount(accountId)) return
      if (result.kind !== 'ok') {
        if (result.kind === 'unknown') {
          await reconcileUnknownMutation(
            'The member removal had an unknown outcome.',
            { callerAccessMayHaveChanged: mem.isSelf },
          )
          return
        }
        fail(null, result.kind === 'rejected' && result.message
          ? result.message
          : m.settings_members_err_remove({ status: result.status }))
        return
      }
      setNotice(m.settings_members_removed())
      if (mem.isSelf) {
        await refreshCallerAccess(true)
      }
      reload()
    } catch (e) {
      await reconcileUnknownMutation(
        `The member removal had an unknown outcome. ${errorMessage(e)}`,
        { callerAccessMayHaveChanged: mem.isSelf },
      )
    } finally {
      endAction()
    }
  }

  // Transfer ownership to `mem` and step the caller down to admin (server-atomic, owner-only). The
  // confirmation makes the loss of Owner authority explicit; only the new owner can hand it back.
  const transferOwnership = async (mem: Member) => {
    const accountId = requestAccountId()
    if (!beginAction(`transfer:${mem.userId}`)) return
    try {
      const result = await teamAccessClient.transferOwnership(accountId, mem.userId)
      if (!isActiveAccount(accountId)) return
      if (result.kind !== 'ok') {
        if (result.kind === 'unknown') {
          await reconcileUnknownMutation(
            'The ownership transfer had an unknown outcome.',
            { callerAccessMayHaveChanged: true },
          )
          return
        }
        fail(null, result.kind === 'rejected' && result.message
          ? result.message
          : m.settings_members_err_transfer({ status: result.status }))
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
      await refreshCallerAccess()
      reload()
    } catch (e) {
      await reconcileUnknownMutation(
        `The ownership transfer had an unknown outcome. ${errorMessage(e)}`,
        { callerAccessMayHaveChanged: true },
      )
    } finally {
      endAction()
    }
  }

  // Mint a single-use password-reset link for `mem` (P1.18). Password mode only (the button is
  // hidden otherwise; the server 400s regardless). No email is ever sent — the admin copies the
  // link out of the write-once block below and hands it over directly. `mem` is NOT `m` (i18n).
  const resetPassword = async (mem: Member) => {
    const accountId = requestAccountId()
    if (!beginAction(`reset:${mem.userId}`)) return
    setResetLink(null)
    try {
      const result = await teamAccessClient.issuePasswordReset(accountId, mem.userId)
      if (!isActiveAccount(accountId)) return
      if (result.kind !== 'ok') {
        if (result.kind === 'unknown') {
          await reconcileUnknownMutation(
            'The reset-token request had an unknown outcome. Its one-time value may be unavailable; retrying this same action will reconcile the original command.',
          )
          return
        }
        if (result.kind === 'invalid') {
          await reconcileUnknownMutation('A reset token was minted but its one-time value was lost. Use the reset action again only to deliberately replace it.')
          return
        }
        fail(null, result.message ?? m.settings_members_err_reset({ status: result.status }))
        return
      }
      const body = result.value
      if (!body?.expiresAt) {
        await reconcileUnknownMutation('A reset token was minted but its one-time value was lost. Use the reset action again only to deliberately replace it.')
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
      await reconcileUnknownMutation(`The reset-token request had an unknown outcome. Its value may be lost; using reset again will replace it. ${errorMessage(e)}`)
    } finally {
      endAction()
    }
  }

  const revokeSessions = async (mem: Member) => {
    const accountId = requestAccountId()
    if (!beginAction(`sessions:${mem.userId}`)) return
    try {
      const result = await teamAccessClient.revokeMemberSessions(accountId, mem.userId)
      if (!isActiveAccount(accountId)) return
      if (result.kind !== 'ok') {
        if (result.kind === 'unknown') {
          if (mem.isSelf) {
            // The command may have invalidated this browser's own session. Re-enter through the
            // auth wall; sessionStorage retains the command identity if an operator retries.
            window.location.reload()
            return
          }
          await reconcileUnknownMutation('Session revocation had an unknown outcome.')
          return
        }
        fail(null, result.kind === 'rejected' && result.message
          ? result.message
          : `Sessions could not be revoked (${result.status}).`)
        return
      }
      setNotice('Active sessions revoked.')
      if (mem.isSelf) window.location.reload()
    } catch (e) {
      if (mem.isSelf) {
        // A rejected transport promise can still follow a committed server-side revocation. Do not
        // leave tenant data rendered under a session whose validity is now unknown.
        window.location.reload()
        return
      }
      await reconcileUnknownMutation(`Session revocation had an unknown outcome. ${errorMessage(e)}`)
    } finally {
      endAction()
    }
  }

  const submitInvite = async () => {
    const accountId = requestAccountId()
    setMintedLink(null)
    const trimmed = invitePreauth.trim()
    if (trimmed.length > MAX_EMAIL_LENGTH || (trimmed.length > 0 && !/^[^@\s]+@[^@\s]+$/.test(trimmed))) {
      fail('invite', m.identity_err_email())
      return
    }
    if (!beginAction('invite:create')) return
    try {
      const result = await teamAccessClient.createInvitation({
          accountId,
          role: inviteRole,
          ...(trimmed ? { preauthEmail: trimmed } : {}),
      })
      if (!isActiveAccount(accountId)) return
      if (result.kind !== 'ok') {
        if (result.kind === 'unknown') {
          await reconcileUnknownMutation(
            'The invite creation had an unknown outcome. Revoke any new unknown invite before creating another.',
          )
          return
        }
        if (result.kind === 'invalid') {
          const message = 'An invite was created but its one-time link was lost. Revoke the unknown invite before creating a replacement.'
          await reconcileUnknownMutation(message)
          fail(null, message)
          return
        }
        fail('invite', result.message ?? m.settings_members_err_create_invite({ status: result.status }))
        return
      }
      const body = result.value
      // The token is write-once: build + show the link straight from this response and never again.
      setMintedLink({
        inviteId: body.id ?? null,
        link: `${window.location.origin}/invite/${body.token}`,
      })
      setInvitePreauth('')
      setNotice(m.settings_members_invite_created())
      reload()
    } catch (e) {
      await reconcileUnknownMutation(`The invite creation had an unknown outcome. Revoke any new unknown invite before creating another. ${errorMessage(e)}`)
    } finally {
      endAction()
    }
  }

  const revokeInvite = async (id: string) => {
    const accountId = requestAccountId()
    if (!beginAction(`invite:revoke:${id}`)) return
    try {
      const result = await teamAccessClient.revokeInvitation(accountId, id)
      if (!isActiveAccount(accountId)) return
      if (result.kind !== 'ok') {
        if (result.kind === 'unknown') {
          await reconcileUnknownMutation('The invite revocation had an unknown outcome.')
          return
        }
        fail(null, result.kind === 'rejected' && result.message
          ? result.message
          : m.settings_members_err_revoke_invite({ status: result.status }))
        return
      }
      setNotice(m.settings_members_invite_revoked())
      setMintedLink((current) => current?.inviteId === id ? null : current)
      reload()
    } catch (e) {
      await reconcileUnknownMutation(`The invite revocation had an unknown outcome. ${errorMessage(e)}`)
    } finally {
      endAction()
    }
  }

  const copyLink = (link: string, copiedNotice: string) => {
    const accountId = requestAccountId()
    const publishNotice = (message: string, tone?: 'error') => {
      if (isActiveAccount(accountId)) setNotice(message, tone)
    }
    // navigator.clipboard is undefined in insecure contexts (plain-HTTP self-hosts, some
    // WebViews). An optional chain there would short-circuit past BOTH .then callbacks —
    // a click that silently does nothing (the swallow DEFENSIVE-CODING.md forbids). Surface
    // the same failure notice instead; its wording already tells the user the manual fallback.
    if (!navigator.clipboard) {
      publishNotice(m.settings_members_copy_failed(), 'error')
      return
    }
    void navigator.clipboard.writeText(link).then(
      () => publishNotice(copiedNotice),
      () => publishNotice(m.settings_members_copy_failed(), 'error'),
    )
  }

  return (
    <>
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
          // Ordinary role changes never touch the Owner. Ownership uses the explicit transfer below.
          const representativeRole: Role = mem.role === 'viewer' ? 'editor' : 'viewer'
          const mayTouch = !!myRole && canManageMemberRole(myRole, mem.role, representativeRole)
          const isOwner = mem.role === 'owner'
          const mayRemove = !!myRole && canRemoveMember(myRole, mem.role)
          // Reset links exist only in PASSWORD mode ('sso' delegates credentials to the IdP; the
          // server 400s there regardless) and never for a target an admin can't touch (e.g. an owner,
          // or a member who owns another account — a reset link is an account-takeover capability).
          // We trust the SERVER-computed `mayResetPassword`: it already folds in the cross-account +
          // self-exemption checks the per-account pure guard can't see AND returns `false` in SSO mode,
          // so the old `authMode === 'password'` / `myRole` conditions here would be redundant.
          const mayReset = mem.mayResetPassword
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
                      onChange={(v) => setRoleChange({ member: mem, nextRole: v as Role })}
                      options={roleOptions()}
                      disabled={busyAction !== null}
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
                {mem.mayRevokeSessions && (
                  <Button variant="ghost" testId="member-revoke-sessions" disabled={busyAction !== null} onClick={() => void revokeSessions(mem)}>
                    Revoke sessions
                  </Button>
                )}
                {mayRemove && (
                  <Button variant="danger" testId="member-remove" disabled={busyAction !== null} onClick={() => void removeMember(mem)}>
                    {m.settings_member_remove()}
                  </Button>
                )}
                {/* Ownership has one path: a confirmed, atomic hand-over that promotes the target and
                    demotes the caller. Generic role selectors never offer Owner. */}
                {myRole === 'owner' && !mem.isSelf && mem.role !== 'owner' && (
                  <Button variant="ghost" testId="member-make-owner" disabled={busyAction !== null} onClick={() => setTransferTarget(mem)}>
                    {m.settings_member_make_owner()}
                  </Button>
                )}
                {isOwner && (
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
      <div className="mb-4 flex flex-col gap-2 rounded border border-line p-3">
        <h3 className="text-xs font-semibold text-ink">{m.settings_invite_heading()}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-32">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">{m.settings_invite_role_label()}</span>
              <select
                data-testid="invite-role"
                aria-label={m.settings_invite_role_aria()}
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InvitationRole)}
                disabled={busyAction !== null}
                className="rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {roleOptions().map((o) => (
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
        <p className="text-xs text-muted" data-testid="invite-role-summary" aria-live="polite">
          {roleSummary(inviteRole)}
        </p>
        <FieldError id={errorId}>{errorField === 'invite' ? error : null}</FieldError>
        {mintedLink && (
          <CopyableLinkBlock
            link={mintedLink.link}
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
    {transferTarget && (
      <ConfirmDialog
        title={m.settings_transfer_owner_title()}
        confirmLabel={m.settings_member_make_owner()}
        message={m.settings_transfer_owner_message({ member: labelFor(transferTarget) })}
        onConfirm={() => {
          const target = transferTarget
          setTransferTarget(null)
          void transferOwnership(target)
        }}
        onCancel={() => setTransferTarget(null)}
      />
    )}
    {roleChange && (
      <ConfirmDialog
        title={m.settings_change_role_title()}
        confirmLabel={m.settings_change_role_confirm()}
        confirmVariant="primary"
        message={m.settings_change_role_message({
          member: labelFor(roleChange.member),
          role: roleLabel(roleChange.nextRole),
          summary: roleSummary(roleChange.nextRole),
        })}
        onConfirm={() => {
          const pending = roleChange
          setRoleChange(null)
          void changeRole(pending.member, pending.nextRole)
        }}
        onCancel={() => setRoleChange(null)}
      />
    )}
    </>
  )
}
