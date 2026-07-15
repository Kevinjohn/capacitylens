import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { AUTH_API as API, AUTH_PASSWORD as PASSWORD, BOOTSTRAP_ADMIN, BOOTSTRAP_TOKEN, signUpUser } from './auth-helpers'

test.use({ reducedMotion: 'reduce' })

// US-NAV-10: the flag-gated login wall, against the auth-backed project's server
// (CAPACITYLENS_AUTH=password on :8887 — see playwright.config.ts). The default deploy keeps
// auth off, so this is the ONLY place the login screen exists; the rest of the suite
// running unchanged in the other two projects is the off-guarantee.

// Shared plumbing (API/PASSWORD/BOOTSTRAP_TOKEN/signUpUser) comes from ./auth-helpers. P1.13: a fresh
// user has NO membership, so GET /api/accounts is empty and the picker would have nothing to pick. The
// org-bootstrap test provisions this login its own org via POST /api/orgs (BOOTSTRAP_TOKEN → Owner) so
// the picker then lists it — account_members is a server-only control table excluded from the shared
// seed, so a membership CAN'T be pre-seeded; bootstrapping is the path.
const EMAIL = 'tester@capacitylens.dev'
const ORG_NAME = `Login Studio ${Date.now()}`

// Sign-up is API-only this round (no form). Idempotent for the FIXED EMAIL (kept LOCAL, not the shared
// signUpUser, because this deliberately TOLERATES a rerun's USER_ALREADY_EXISTS 422 rather than
// asserting a fresh success): a rerun against a reused server hits 422, which is fine — the user
// exists either way, and it uses the shared `request` jar (no cookie needed here).
async function seedUser(request: APIRequestContext, email = EMAIL) {
  const res = await request.post(`${API}/api/auth/sign-up/email`, {
    data: { email, password: PASSWORD, name: 'Tester' },
  })
  if (!res.ok()) expect(res.status()).toBe(422)
}

test.describe('login screen (CAPACITYLENS_AUTH=password)', () => {
  test('unauthenticated visit shows the login screen, not the app — and the API 401s', async ({
    page,
    request,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    // The wall is total: no company picker, no nav, no data.
    await expect(page.getByRole('heading', { name: 'Choose a company' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Schedule' })).toHaveCount(0)
    expect((await request.get(`${API}/api/state`)).status()).toBe(401)

    // A wrong password fails inline, on the same screen.
    await seedUser(request)
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password').fill('not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    // a11y oracle while the screen is up (US-NAV-10 acceptance).
    const results = await new AxeBuilder({ page }).analyze()
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(
      blocking,
      JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2),
    ).toEqual([])
  })

  test('signing in reveals the app; signing out from Settings returns to the login screen', async ({
    page,
    request,
  }) => {
    // P1.13: bootstrap THIS login its own org so the picker (now sourced from the login's memberships
    // via GET /api/accounts) has something to list. A FRESH per-run user guarantees the sign-up cookie
    // (no 422 on a reused DB); /api/orgs makes the caller the org's Owner.
    const { email, cookie } = await signUpUser(`login-${Date.now()}@capacitylens.dev`)
    const orgRes = await request.post(`${API}/api/orgs`, {
      headers: { cookie, 'x-capacitylens-bootstrap-token': BOOTSTRAP_TOKEN },
      data: { name: ORG_NAME },
    })
    expect(orgRes.status()).toBe(201)

    await page.goto('/')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // The boot flow resumes: the picker lists ONLY this login's memberships (P1.13) → pick our org →
    // the active account hydrates its slice via GET /api/state?accountId= → the post-login intro → app.
    // exact: true — a bare name would also match a "Delete <name>" control.
    await page.getByRole('button', { name: ORG_NAME, exact: true }).click()
    // The "What CapacityLens is" intro gate fires after the company pick in every entry mode (incl. real
    // auth — they all converge on a chosen account); dismiss it to reach the app.
    await expect(page.getByRole('heading', { name: 'Welcome to CapacityLens' })).toBeVisible()
    await page.getByTestId('intro-continue').click()
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()

    // Settings gains the Account section only on an auth-enabled deploy.
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
    await page.getByRole('button', { name: 'Sign out' }).click()

    // Session gone: back behind the wall, and a reload stays there.
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('the --create-owner-admin-admin bootstrap credential signs in through the real form', async ({
    page,
  }) => {
    // The auth-e2e server boots with CAPACITYLENS_CREATE_ADMIN_ADMIN=1 and a pinned
    // The e2e server pins a policy-compliant bootstrap password on a wiped DB.
    // as its first user (production instead mints a generated password). This proves the escape hatch
    // end-to-end — including that the 5-char password (below the sign-UP minimum) signs IN fine
    // after boot, the assumption the whole bootstrap design rests on. A fresh bootstrap admin has
    // no memberships, so landing on the (empty) company picker past the wall is the success state.
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.getByLabel('Email').fill(BOOTSTRAP_ADMIN.email)
    await page.getByLabel('Password').fill(BOOTSTRAP_ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Start planning' })).toBeVisible()
  })

  test('a login with NO memberships sees an EMPTY picker (tenant isolation — no cross-tenant leak)', async ({
    page,
    request,
  }) => {
    // P1.13 isolation: a fresh user with NO org bootstrapped sees no companies — the picker lists ONLY
    // the login's memberships, never another tenant's org (the no-arg whole read that leaked all tenants
    // is closed in auth-on). And since canCreateAccount now reflects the caller's actual standing
    // (owner/admin somewhere — the same predicate POST /api/orgs enforces), a membership-less login
    // on an instance with existing accounts sees NO "New company" affordance either: the old button
    // was a dead end (submission always 403'd). The empty state tells them to ask for an invite.
    const lonely = `lonely-${Date.now()}@capacitylens.dev`
    await seedUser(request, lonely)
    await page.goto('/')
    await page.getByLabel('Email').fill(lonely)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Past the wall, on the picker — but with no company button (no other tenant's org leaked in).
    await expect(page.getByRole('heading', { name: 'Start planning' })).toBeVisible()
    await expect(page.getByText('Ask an admin for an invite to join a company.')).toBeVisible()
    await expect(page.getByRole('button', { name: ORG_NAME, exact: true })).toHaveCount(0)
    // No doomed create affordance: the server would 403 a membership-less org create.
    await expect(page.getByRole('button', { name: 'New company' })).toHaveCount(0)
  })
})
