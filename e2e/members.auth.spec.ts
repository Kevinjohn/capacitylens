import { test, expect } from '@playwright/test'
import { AUTH_API as API, AUTH_PASSWORD as PASSWORD, BOOTSTRAP_TOKEN, signUpUser as signUp } from './auth-helpers'

test.use({ reducedMotion: 'reduce' })

// P1.11 — Owner/Admin member management, against the auth-backed project's server
// (CAPACITYLENS_AUTH=password on :8887 — see playwright.config.ts). Owner A bootstraps an org and
// invites admin B + editor C (both accept via the API). Then, as B (admin), we drive the Settings →
// Members UI: list members, change C editor→viewer, mint a viewer invite (the link appears once),
// revoke it. We assert the owner option AND the "Make owner" transfer affordance are ABSENT for B in
// the UI, and at the API layer that B cannot grant owner (PATCH …members/<C> {role:'owner'} → 403),
// cannot touch owner A (→ 403), cannot transfer ownership (→ 403), that the sole owner A cannot remove
// themselves (→ 403), and — the cross-tenant headline — that B cannot read ANOTHER account's members
// (→ 403). Finally owner A hands ownership to C (→ 200; C becomes owner, A steps down to admin).
// Browser-agnostic (no UA branching).

// Shared plumbing (API/PASSWORD/BOOTSTRAP_TOKEN/signUp) comes from ./auth-helpers.
const STAMP = Date.now()
const OWNER = `m-owner-${STAMP}@capacitylens.dev`
const ADMIN = `m-admin-${STAMP}@capacitylens.dev`
const EDITOR = `m-editor-${STAMP}@capacitylens.dev`

test.describe('member management (CAPACITYLENS_AUTH=password)', () => {
  test('admin manages members but not owner-only ops; owner is last-owner protected; no cross-tenant leak', async ({
    page,
    request,
  }) => {
    // ── API setup: owner A bootstraps an org, invites B (admin) + C (editor); both accept. ─────────
    const owner = await signUp(OWNER)
    const admin = await signUp(ADMIN)
    const editor = await signUp(EDITOR)

    const orgRes = await request.post(`${API}/api/orgs`, {
      headers: { cookie: owner.cookie, 'x-capacitylens-bootstrap-token': BOOTSTRAP_TOKEN },
      data: { name: `Members Studio ${STAMP}` },
    })
    expect(orgRes.status()).toBe(201)
    const accountId = (await orgRes.json()).id as string

    // Mint + accept an admin invite for B and an editor invite for C.
    for (const [who, role] of [
      [admin, 'admin'],
      [editor, 'editor'],
    ] as const) {
      const inv = await request.post(`${API}/api/invites`, {
        headers: { cookie: owner.cookie },
        data: { accountId, role },
      })
      expect(inv.status()).toBe(201)
      const token = (await inv.json()).token as string
      const accept = await request.post(`${API}/api/invites/${token}/accept`, {
        headers: { cookie: who.cookie },
      })
      expect(accept.status()).toBe(200)
    }

    // ── API layer: the owner-only constraints B (admin) must NOT be able to cross. ─────────────────
    // B cannot GRANT owner (no admin→owner escalation).
    const grant = await request.patch(`${API}/api/accounts/${accountId}/members/${editor.userId}`, {
      headers: { cookie: admin.cookie },
      data: { role: 'owner' },
    })
    expect(grant.status()).toBe(403)
    // B cannot touch owner A.
    const touchOwner = await request.patch(`${API}/api/accounts/${accountId}/members/${owner.userId}`, {
      headers: { cookie: admin.cookie },
      data: { role: 'editor' },
    })
    expect(touchOwner.status()).toBe(403)
    // B cannot transfer ownership — it is owner-only, one rank above admin.
    const adminTransfer = await request.post(`${API}/api/accounts/${accountId}/transfer-ownership`, {
      headers: { cookie: admin.cookie },
      data: { toUserId: editor.userId },
    })
    expect(adminTransfer.status()).toBe(403)
    // Owner A (the sole owner) cannot remove themselves — last-owner protection.
    const selfRemove = await request.delete(`${API}/api/accounts/${accountId}/members/${owner.userId}`, {
      headers: { cookie: owner.cookie },
    })
    expect(selfRemove.status()).toBe(403)

    // Cross-tenant headline: B (admin of THIS org) cannot read members of an account B is NOT in. The
    // authorize seam 403s a non-member before any data leaves the DB, so an account B doesn't belong to
    // is forbidden — there is no member leak across the tenant boundary.
    const crossTenant = await request.get(`${API}/api/accounts/some-other-account-${STAMP}/members`, {
      headers: { cookie: admin.cookie },
    })
    expect(crossTenant.status()).toBe(403) // non-member of that account → forbidden, no leak

    // ── Browser: sign in as B (admin) and drive Settings → Members. ────────────────────────────────
    await page.goto('/')
    await page.getByRole('heading', { name: 'Sign in' }).waitFor()
    await page.getByLabel('Email').fill(ADMIN)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // B is a member of exactly the new org; pick it from the company picker, dismiss the intro.
    await page.getByRole('button', { name: `Members Studio ${STAMP}`, exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Welcome to CapacityLens' })).toBeVisible()
    await page.getByTestId('intro-continue').click()

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()

    // The member list shows all three (owner A, admin B = you, editor C).
    const rows = page.getByTestId('member-row')
    await expect(rows).toHaveCount(3)
    await expect(page.getByText(OWNER)).toBeVisible()
    await expect(page.getByText(EDITOR)).toBeVisible()

    // The invite role picker offers NO owner option for an admin.
    const inviteOwnerOption = page.locator('[data-testid="invite-role"] option[value="owner"]')
    await expect(inviteOwnerOption).toHaveCount(0)
    // Nor a "Make owner" button on any row — transfer of ownership is owner-only, invisible to B.
    await expect(page.getByTestId('member-make-owner')).toHaveCount(0)

    // B changes C from editor → viewer through the UI (C's row has a role select).
    const editorRow = rows.filter({ hasText: EDITOR })
    await editorRow.getByTestId('member-role-select').locator('select').selectOption('viewer')
    // The server confirms the change.
    await expect
      .poll(async () => {
        const res = await request.get(`${API}/api/accounts/${accountId}/members`, {
          headers: { cookie: admin.cookie },
        })
        const members = (await res.json()).members as Array<{ userId: string; role: string }>
        return members.find((m) => m.userId === editor.userId)?.role
      })
      .toBe('viewer')

    // B mints a viewer invite via the form; the link appears ONCE.
    await page.getByTestId('invite-role').selectOption('viewer')
    await page.getByTestId('invite-submit').click()
    await expect(page.getByTestId('invite-link')).toContainText('/invite/')

    // The new invite shows in the outstanding list (newest first); B revokes it. The earlier admin +
    // editor invites are also listed (used), so revoking one drops the count by exactly one. Wait for
    // the list to settle (the create refetch) before reading the count, then assert it strictly drops.
    const inviteRows = page.getByTestId('invite-row')
    await expect(inviteRows).toHaveCount(3) // admin + editor (used) + the just-minted viewer
    await inviteRows.first().getByTestId('invite-revoke').click()
    await expect(inviteRows).toHaveCount(2)

    // ── Owner-only transfer of ownership (API): B (admin) was refused above; the real owner A hands
    // the account to C, atomically — C becomes owner and A steps down to admin. ─────────────────────
    const transfer = await request.post(`${API}/api/accounts/${accountId}/transfer-ownership`, {
      headers: { cookie: owner.cookie },
      data: { toUserId: editor.userId },
    })
    expect(transfer.status()).toBe(200)
    await expect
      .poll(async () => {
        const res = await request.get(`${API}/api/accounts/${accountId}/members`, {
          headers: { cookie: owner.cookie }, // A is now an admin, but an admin may still list members
        })
        const members = (await res.json()).members as Array<{ userId: string; role: string }>
        return [
          members.find((m) => m.userId === editor.userId)?.role,
          members.find((m) => m.userId === owner.userId)?.role,
        ]
      })
      .toEqual(['owner', 'admin']) // C promoted, A demoted — exactly one owner throughout
  })
})
