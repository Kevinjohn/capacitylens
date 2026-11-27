import { expect, test } from './fixtures'
import {
  AUTH_API,
  bootstrapOrg,
  clearAuthE2ECompanies,
  readAuthE2EBaselineSnapshot,
  signUpUser,
} from './authTestKit'

test('clearing the native company fixtures restores the baseline and keeps unrelated users', async ({
  request,
}) => {
  const baseline = readAuthE2EBaselineSnapshot()
  const suffix = crypto.randomUUID()
  const user = await signUpUser(`cleanup-cycle-${suffix}@capacitylens.dev`, 'Diana Prince')
  const temporaryCompanyId = await bootstrapOrg(request, user.cookie, `Cleanup Company ${suffix}`)
  const temporaryState = await request.get(
    `${AUTH_API}/api/v1/state?companyId=${temporaryCompanyId}`,
    {
      headers: { cookie: user.cookie },
    }
  )
  expect(temporaryState.status()).toBe(200)

  clearAuthE2ECompanies()

  const restored = readAuthE2EBaselineSnapshot()
  expect(restored.company.id).not.toBe(baseline.company.id)
  expect(restored.company).toMatchObject({
    name: 'Daily Planet E2E Baseline',
    scheduling_mode: 'days',
    week_starts_on: 1,
    working_days: '[1,2,3,4,5]',
    disciplines_enabled: 0,
    placeholders_enabled: 0,
    external_enabled: 0,
    inline_activity_create_enabled: 0,
  })
  expect(restored.client).toMatchObject({
    id: `internal:${restored.company.id}`,
    name: 'Internal',
    builtin: 1,
  })
  expect(restored.revision).toBe(1)
  expect(restored.owner).toMatchObject({
    email: 'baseline-owner@capacitylens.dev',
    role: 'owner',
    status: 'active',
  })
  expect(restored.administrator).toMatchObject({ email: 'admin@admin.admin', memberships: 0 })
  expect(restored.initializationHistory).toBe(1)

  const me = await request.get(`${AUTH_API}/api/v1/auth/me`, { headers: { cookie: user.cookie } })
  expect(me.status()).toBe(200)
  const hiddenBaseline = await request.get(
    `${AUTH_API}/api/v1/state?companyId=${restored.company.id}`,
    {
      headers: { cookie: user.cookie },
    }
  )
  expect(hiddenBaseline.status()).toBe(403)
  const companies = await request.get(`${AUTH_API}/api/v1/companies`, {
    headers: { cookie: user.cookie },
  })
  expect(await companies.json()).toEqual({ data: [] })
})
