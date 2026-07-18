import { test, expect } from '@playwright/test'
import { AUTH_API as API, AUTH_PASSWORD as PASSWORD, BOOTSTRAP_TOKEN, signUpUser as signUp } from './auth-helpers'

test.use({ reducedMotion: 'reduce' })

// P1.12 — Viewer read-only mode, against the auth-backed project's server (SMALLSASS_ACCOUNT_MODE=password
// on :8887 — see playwright.config.ts). Owner A bootstraps an org and invites a VIEWER V + an EDITOR
// E (both accept via the API). Signed in as V (viewer) we assert the read-only UI: no "Add client",
// no row Edit/Delete, an allocation bar with no resize grips, a draw gesture creates nothing, and the
// "View only" badge is shown. As E (editor) we assert the contrast — the affordances are present. At
// the API layer a direct write as the viewer is 403 (the server is the authoritative backstop).
// Browser-agnostic (no UA branching); unique emails per run.

// Shared plumbing (API/PASSWORD/BOOTSTRAP_TOKEN/signUp) comes from ./auth-helpers.
const STAMP = Date.now()
const OWNER = `v-owner-${STAMP}@capacitylens.dev`
const VIEWER = `v-viewer-${STAMP}@capacitylens.dev`
const EDITOR = `v-editor-${STAMP}@capacitylens.dev`

/** Sign in through the browser login wall and pick the org, dismissing the intro IF it shows. The
 *  intro is once-per-device (localStorage `capacitylens/introSeen`), so on the SECOND sign-in in the
 *  same browser context (viewer → editor) it won't reappear — handle it conditionally. */
async function signInAndOpen(page: import('@playwright/test').Page, email: string, org: string) {
  await page.goto('/')
  await page.getByRole('heading', { name: 'Sign in' }).waitFor()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: org, exact: true }).click()
  // The intro is once-per-device; on the second sign-in it won't reappear. Wait for EITHER the intro
  // OR the app (Schedule heading) to settle the race, then dismiss the intro if present.
  const intro = page.getByTestId('intro-continue')
  await expect(intro.or(page.getByRole('heading', { name: 'Schedule' })).first()).toBeVisible()
  if (await intro.isVisible().catch(() => false)) await intro.click()
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible()
}

test.describe('viewer read-only mode (SMALLSASS_ACCOUNT_MODE=password)', () => {
  test('a viewer sees no edit affordances; an editor does; a direct viewer write is 403', async ({
    page,
    request,
    context,
  }) => {
    // ── API setup: owner A bootstraps an org, invites V (viewer) + E (editor); both accept. ────────
    const owner = await signUp(OWNER)
    const viewer = await signUp(VIEWER)
    const editor = await signUp(EDITOR)

    const orgRes = await request.post(`${API}/api/orgs`, {
      headers: { cookie: owner.cookie, 'x-capacitylens-bootstrap-token': BOOTSTRAP_TOKEN },
      data: { name: `Viewer Studio ${STAMP}` },
    })
    expect(orgRes.status()).toBe(201)
    const accountId = (await orgRes.json()).id as string

    for (const [who, role] of [
      [viewer, 'viewer'],
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

    // ── API backstop: a direct scheduling write as the VIEWER is 403 (the true boundary). ──────────
    // The client gating below is UX + defense-in-depth; THIS is what actually enforces read-only. The
    // entity write verb is PUT /api/:entity/:id with accountId in the body (the P1.5 write gate keys
    // off it): the write tier is editor+, so a viewer is forbidden before any row is touched.
    const newClientId = `new-client-${STAMP}`
    const directWrite = await request.put(`${API}/api/clients/${newClientId}`, {
      headers: { cookie: viewer.cookie, 'content-type': 'application/json' },
      data: {
        id: newClientId,
        accountId,
        name: 'Should be rejected',
        color: '#3b82f6',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })
    expect(directWrite.status()).toBe(403)

    // ── Browser as VIEWER: the read-only UI. ───────────────────────────────────────────────────────
    await signInAndOpen(page, VIEWER, `Viewer Studio ${STAMP}`)

    // The role is visible in the sidebar footer, and Team & access remains available so a Viewer
    // can understand the role without being shown the company directory or management controls.
    await expect(page.getByTestId('getting-started')).toHaveCount(0)
    await expect(page.getByTestId('view-only')).toBeVisible()
    await expect(page.getByTestId('active-role')).toContainText('Viewer')
    await page.getByRole('link', { name: 'Team & access' }).click()
    const currentAccess = page.getByTestId('current-access')
    await expect(currentAccess).toContainText('Viewer')
    await expect(currentAccess.getByText('View the schedule')).toBeVisible()
    await expect(currentAccess.getByText('Edit scheduling data')).toHaveClass(/text-muted/)
    await expect(page.getByText(/An Owner or Admin manages invitations/)).toBeVisible()
    await expect(page.getByTestId('members-section')).toHaveCount(0)

    // Clients list: no top "Add client" create affordance, and no row Edit/Delete buttons.
    await page.getByRole('link', { name: 'Clients' }).click()
    await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add client' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)

    // Scheduler: the draw-mode toggle + Undo/Redo are hidden.
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Draw mode' })).toHaveCount(0)
    await expect(page.getByTestId('undo-button')).toHaveCount(0)
    await expect(page.getByTestId('redo-button')).toHaveCount(0)

    // A draw gesture on a lane creates nothing (the lane bails — no onDraw). The fresh org has no
    // resources/lanes seeded, so assert the schedule has no allocation bars before AND after a drag.
    await expect(page.getByTestId('allocation-bar')).toHaveCount(0)
    const grid = page.getByTestId('scheduler-grid')
    const box = await grid.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2)
      await page.mouse.up()
    }
    await expect(page.getByTestId('allocation-bar')).toHaveCount(0)

    // ── Browser as EDITOR (contrast): the same surfaces SHOW the affordances. ────────────────────────
    await context.clearCookies()
    await signInAndOpen(page, EDITOR, `Viewer Studio ${STAMP}`)

    // No "View only" badge for an editor.
    await expect(page.getByTestId('view-only')).toHaveCount(0)
    await expect(page.getByTestId('getting-started')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Invite your team' })).toHaveCount(0)

    await page.getByRole('link', { name: 'Clients' }).click()
    await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add client' })).toBeVisible()

    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByRole('group', { name: 'Draw mode' })).toBeVisible()
    await expect(page.getByTestId('undo-button')).toBeVisible()
  })
})
