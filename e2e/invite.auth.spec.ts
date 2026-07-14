import { test, expect } from '@playwright/test'
import { AUTH_API as API, AUTH_PASSWORD as PASSWORD, BOOTSTRAP_TOKEN, signUpUser } from './auth-helpers'
import { dismissIntroIfPresent } from './helpers'

test.use({ reducedMotion: 'reduce' })

// P1.9 — invite accept, against the auth-backed project's server (CAPACITYLENS_AUTH=password on
// :8887 — see playwright.config.ts). Owner A signs up, bootstraps an org (via the operator bootstrap
// token, since the auth-e2e DB is seeded so A is not first-run), and mints an editor invite token via
// POST /api/invites. User B then opens /invite/<token> in the browser: with no session the accept
// 401s and the invite page shows its OWN inline onboarding form (the route is deliberately carved out
// of the login wall — see InviteAccept.tsx); B signs in there, the page reloads and the accept POST
// binds B as an editor — the "joined" success state. Finally we assert the API-layer single-use
// guarantee (re-POSTing the same token is 409). Browser-agnostic (no UA branching).

// The auth-e2e server is SEEDED (Studio North + Loft Digital), so a fresh sign-up is not a first-run
// bootstrap and holds no membership — /api/orgs would 403; the BOOTSTRAP_TOKEN (from ./auth-helpers)
// is the documented operator path to provision an org on an already-populated instance. Shared
// plumbing (API/BOOTSTRAP_TOKEN/signUp) comes from ./auth-helpers.
const STAMP = Date.now()
const OWNER = `owner-${STAMP}@capacitylens.dev`
const JOINER = `joiner-${STAMP}@capacitylens.dev`

test.describe('invite accept (CAPACITYLENS_AUTH=password)', () => {
  test('a signed-in user opens a valid invite link and joins; reusing the token is 409', async ({
    page,
    request,
  }) => {
    // Owner A: sign up (auto-signed-in → session cookie), bootstrap an org, mint an invite. The
    // explicit `cookie` header (not the shared jar) carries A's session on each call.
    const ownerCookie = (await signUpUser(OWNER)).cookie

    const orgRes = await request.post(`${API}/api/orgs`, {
      headers: { cookie: ownerCookie, 'x-capacitylens-bootstrap-token': BOOTSTRAP_TOKEN },
      data: { name: `Invite Studio ${STAMP}` },
    })
    expect(orgRes.status()).toBe(201)
    const accountId = (await orgRes.json()).id as string

    const inviteRes = await request.post(`${API}/api/invites`, {
      headers: { cookie: ownerCookie },
      data: { accountId, role: 'editor' },
    })
    expect(inviteRes.status()).toBe(201)
    const token = (await inviteRes.json()).token as string
    expect(token.length).toBeGreaterThan(0)

    // User B exists (sign-up is API-only; keep B's session cookie for the API reuse check below).
    // Opening /invite/<token> in the browser has NO session, so the accept POST 401s and the invite
    // page shows its OWN inline onboarding form (the route is carved out of the login wall so an
    // invitee signs in — or creates an account — in place; see InviteAccept.tsx).
    const joinerCookie = (await signUpUser(JOINER)).cookie
    await page.goto(`/invite/${token}`)

    // The invite page's own form (heading "Accept invite"), NOT the app login wall: B signs in here.
    await expect(page.getByRole('heading', { name: 'Accept invite' })).toBeVisible()
    await page.getByLabel('Email').fill(JOINER)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in and accept' }).click()

    // "Sign in and accept" signs B in and reloads onto the same /invite/<token> URL; the accept POST
    // then binds B as an editor and the success state renders.
    await expect(page.getByText(/You’ve joined this company/)).toBeVisible()

    // Continue must land INSIDE the joined company, not on the picker: the accept flow refetches
    // the summaries list (this route mounts outside AppShell, so the hook never ran here) and
    // activates the joined account before this link is used. Regression guard for the handoff that
    // used to bounce to the picker with a "company not found" notice. A first visit on this device
    // may hit the once-per-device intro page — click through it like helpers.openApp does.
    await page.getByRole('link', { name: 'Continue' }).click()
    // Wait on the in-app company name — NOT a bare role=main, which the invite page itself also
    // renders (a main-based wait resolves before the navigation lands; the pitfall is documented
    // on dismissIntroIfPresent).
    await dismissIntroIfPresent(page, page.getByText(`Invite Studio ${STAMP}`))
    // In the app, in the joined company — the shell shows its name, and no picker heading.
    await expect(page.getByText(`Invite Studio ${STAMP}`)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Choose a company' })).toHaveCount(0)

    // Single-use guarantee at the API layer: the browser accept already consumed the token, so a
    // second accept (B's API session) of the same token is 409.
    const reuse = await request.post(`${API}/api/invites/${token}/accept`, {
      headers: { cookie: joinerCookie },
    })
    expect(reuse.status()).toBe(409)
  })
})
