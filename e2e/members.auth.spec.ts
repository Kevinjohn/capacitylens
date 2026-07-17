import { test, expect } from '@playwright/test'
import {
  AUTH_API as API,
  AUTH_PASSWORD as PASSWORD,
  BOOTSTRAP_TOKEN,
  signUpUser as signUp,
  signUpUserWithId,
} from './auth-helpers'
import { dismissIntroIfPresent } from './helpers'

test.use({ reducedMotion: 'reduce' })

// P1.11 — Owner/Admin member management, against the auth-backed project's server
// (CAPACITYLENS_AUTH=password on :8887 — see playwright.config.ts). Owner A bootstraps an org and
// invites admin B + editor C (both accept via the API). Then, as B (admin), we drive the Team &
// access UI: list members, change C editor→viewer, mint a viewer invite (the link appears once),
// revoke it. We assert the Owner option AND the transfer affordance are ABSENT for B in
// the UI, and at the API layer that nobody can assign Owner through PATCH (400),
// cannot touch owner A (→ 403), cannot transfer ownership (→ 403), that owner membership cannot be
// removed through the ordinary member endpoint (→ 403), and — the cross-tenant headline — that B
// cannot read ANOTHER account's members (→ 403). Finally owner A transfers through the UI and the
// live shell immediately reprojects A as Admin. Browser-agnostic (no UA branching).

// Shared plumbing (API/PASSWORD/BOOTSTRAP_TOKEN/signUp/signUpUserWithId) comes from ./auth-helpers.
const STAMP = Date.now()
const OWNER = `m-owner-${STAMP}@capacitylens.dev`
const ADMIN = `m-admin-${STAMP}@capacitylens.dev`
const EDITOR = `m-editor-${STAMP}@capacitylens.dev`

test.describe('member management (CAPACITYLENS_AUTH=password)', () => {
  test('admin manages members but not owner-only ops; ownership changes only by transfer; no cross-tenant leak', async ({
    page,
    request,
    browser,
  }) => {
    // ── API setup: owner A bootstraps an org, invites B (admin) + C (editor); both accept. ─────────
    // Owner and editor are targeted by userId below (PATCH/DELETE members/<id>, transfer-ownership
    // toUserId) — the id-resolving variant. Admin is only ever used by its cookie.
    const owner = await signUpUserWithId(OWNER)
    const admin = await signUp(ADMIN)
    const editor = await signUpUserWithId(EDITOR)

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
    expect(grant.status()).toBe(400)
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
    // Owner A cannot remove themselves through ordinary membership management; ownership has the
    // dedicated transactional transfer path instead.
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

    // ── Browser: sign in as B (admin) and drive Team & access. ────────────────────────────────────
    await page.goto('/')
    await page.getByRole('heading', { name: 'Sign in' }).waitFor()
    await page.getByLabel('Email').fill(ADMIN)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // B is a member of exactly the new org; pick it from the company picker, dismiss the intro.
    await page.getByRole('button', { name: `Members Studio ${STAMP}`, exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Welcome to CapacityLens' })).toBeVisible()
    await page.getByTestId('intro-continue').click()

    await expect(page.getByTestId('getting-started')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Invite your team' })).toHaveAttribute('href', '/team')
    await page.getByRole('link', { name: 'Team & access' }).click()
    await expect(page.getByTestId('current-access')).toContainText('Admin')
    await expect(page.getByRole('heading', { name: 'App members', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Scheduled resources', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Members', exact: true })).toBeVisible()

    // The member list shows all three (owner A, admin B = you, editor C).
    const rows = page.getByTestId('member-row')
    await expect(rows).toHaveCount(3)
    await expect(page.getByText(OWNER)).toBeVisible()
    await expect(page.getByText(EDITOR)).toBeVisible()

    // The invite role picker offers NO owner option for an admin.
    const inviteOwnerOption = page.locator('[data-testid="invite-role"] option[value="owner"]')
    await expect(inviteOwnerOption).toHaveCount(0)
    // Nor a transfer button on any row — transfer of ownership is owner-only, invisible to B.
    await expect(page.getByTestId('member-make-owner')).toHaveCount(0)

    // B changes C from editor → viewer through the UI (C's row has a role select).
    const editorRow = rows.filter({ hasText: EDITOR })
    await editorRow.getByTestId('member-role-select').locator('select').selectOption('viewer')
    await expect(page.getByRole('dialog')).toContainText('will become Viewer')
    await expect(page.getByRole('dialog')).toContainText('Read-only schedule access')
    await page.getByRole('dialog').getByRole('button', { name: 'Change role' }).click()
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
    const mintedInviteLink = await page.getByTestId('invite-link').textContent()

    // Changing somebody else's role re-reads the directory but does not invalidate the caller's
    // membership projection or unmount this write-once link. The bearer must remain copyable until
    // the admin deliberately leaves the page.
    await editorRow.getByTestId('member-role-select').locator('select').selectOption('editor')
    await page.getByRole('dialog').getByRole('button', { name: 'Change role' }).click()
    await expect(page.getByTestId('invite-link')).toHaveText(mintedInviteLink ?? '')

    // The new invite shows in the outstanding list (newest first); B revokes it. The earlier admin +
    // editor invites are also listed (used), so revoking one drops the count by exactly one. Wait for
    // the list to settle (the create refetch) before reading the count, then assert it strictly drops.
    const inviteRows = page.getByTestId('invite-row')
    await expect(inviteRows).toHaveCount(3) // admin + editor (used) + the just-minted viewer
    await inviteRows.first().getByTestId('invite-revoke').click()
    await expect(inviteRows).toHaveCount(2)
    await expect(page.getByTestId('invite-link')).toHaveCount(0)

    // ── Owner-only transfer in a separate browser: A hands the account to C atomically. The same
    // mounted app must immediately refetch both membership projections: current access/sidebar show
    // Admin and owner-only transfer controls disappear, without a reload or account switch. ────────
    const ownerContext = await browser.newContext({ reducedMotion: 'reduce' })
    const ownerPage = await ownerContext.newPage()
    await ownerPage.goto('/')
    await ownerPage.getByRole('heading', { name: 'Sign in' }).waitFor()
    await ownerPage.getByLabel('Email').fill(OWNER)
    await ownerPage.getByLabel('Password').fill(PASSWORD)
    await ownerPage.getByRole('button', { name: 'Sign in' }).click()
    await ownerPage.getByRole('button', { name: `Members Studio ${STAMP}`, exact: true }).click()
    await dismissIntroIfPresent(ownerPage, ownerPage.locator('#main'))
    await ownerPage.getByRole('link', { name: 'Team & access' }).click()
    await expect(ownerPage.getByTestId('current-access')).toContainText('Owner')

    const ownerTarget = ownerPage.getByTestId('member-row').filter({ hasText: EDITOR })
    await ownerTarget.getByTestId('member-make-owner').click()
    await ownerPage.getByRole('dialog').getByRole('button', { name: 'Transfer ownership' }).click()

    await expect(ownerPage.getByTestId('current-access')).toContainText('Admin')
    await expect(ownerPage.getByTestId('active-role')).toContainText('Admin')
    await expect(ownerPage.getByTestId('member-make-owner')).toHaveCount(0)
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
    await ownerContext.close()
  })
})
