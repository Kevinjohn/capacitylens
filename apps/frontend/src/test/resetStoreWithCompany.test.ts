import { describe, expect, it } from 'vitest'
import { makeResourceDraft, resetStoreWithCompany } from '@/test/fixtures'
import { useStore } from '@/store/useStore'

describe('resetStoreWithCompany', () => {
  it('restores the seeded rows and revision on a repeated same-company reset', async () => {
    const companyId = 'acct-repeat-reset'
    await resetStoreWithCompany(companyId)
    await useStore.getState().updateCompany(companyId, { name: 'Changed Test Co' })
    expect(useStore.getState().planning.revision).toBe(1)

    await expect(resetStoreWithCompany(companyId)).resolves.toBe(true)

    expect(useStore.getState().planning.revision).toBe(0)
    expect(useStore.getState().data.companies.map(({ name }) => name)).toEqual(['Test Co'])
    expect(useStore.getState().planning.context?.companyId).toBe(companyId)
    expect(useStore.getState().planning.phase.kind).toBe('ready')
  })
  it('resets a selected company after its context is cleared, removes prior rows and permits a new write', async () => {
    const companyId = 'acct-cleared-context'
    await resetStoreWithCompany(companyId)
    await useStore.getState().addResource(makeResourceDraft({ name: 'Clark Kent' }))
    expect(useStore.getState().data.resources).toHaveLength(1)
    useStore.setState({ planning: { ...useStore.getState().planning, context: null } })
    expect(useStore.getState().activeCompanyId).toBe(companyId)
    await expect(resetStoreWithCompany(companyId)).resolves.toBe(true)
    expect(useStore.getState().data.resources).toHaveLength(0)
    await useStore.getState().updateCompany(companyId, { name: 'New Company' })
    expect(useStore.getState().data.companies[0]?.name).toBe('New Company')
  })
})
