import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CompanySetup } from './CompanySetup'
import { createRequestLog } from '@/test/fetchRequests'

afterEach(() => vi.unstubAllGlobals())

/** Stub fetch with fresh replies in order, repeating the last, and record what each call sends. */
function stubFetch(...replies: Array<() => Response>) {
  const requests = createRequestLog()
  let index = 0
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.record(input, init)
    const reply = replies[Math.min(index++, replies.length - 1)]
    if (!reply) throw new Error('Expected a stubbed reply')
    return reply()
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, requests }
}

async function sentBodies(requests: ReturnType<typeof createRequestLog>): Promise<unknown[]> {
  const sent = await requests.read()
  return sent.map(({ body }) => body)
}

it('asks for company name and calendar convention and preserves it after a retryable failure', async () => {
  const complete = vi.fn()
  const { requests } = stubFetch(
    () => new Response(JSON.stringify({ error: 'Setup unavailable. Try again.' }), { status: 503 }),
    () => new Response(JSON.stringify({ companyId: 'wayne' }), { status: 201 })
  )
  render(<CompanySetup onCreated={complete} onConflict={async () => false} onSignOut={vi.fn()} />)
  expect(screen.getAllByRole('textbox')).toHaveLength(1)
  fireEvent.change(screen.getByLabelText('Company name'), {
    target: { value: 'Wayne Enterprises' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create company' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Setup unavailable. Try again.')
  expect(screen.getByLabelText('Company name')).toHaveValue('Wayne Enterprises')
  expect(complete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Create company' }))
  await waitFor(() => expect(complete).toHaveBeenCalledOnce())
  expect(await sentBodies(requests)).toContain(
    JSON.stringify({ name: 'Wayne Enterprises', weekStartsOn: 1, timeZone: 'Etc/GMT' })
  )
})

it('reconciles a concurrent winner once and leaves an unconfirmed refusal visible', async () => {
  const reconcile = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const created = vi.fn()
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ error: 'First company setup is unavailable for this installation.' }),
        {
          status: 409,
        }
      )
  )
  vi.stubGlobal('fetch', fetch)
  render(<CompanySetup onCreated={created} onConflict={reconcile} onSignOut={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Company name'), {
    target: { value: 'Wayne Enterprises' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create company' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('First company setup is unavailable')
  expect(fetch).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Create company' }))
  await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2))
  expect(created).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('sends the selected Sunday week and IANA zone', async () => {
  const { fetch, requests } = stubFetch(() =>
    Response.json({ companyId: 'wayne' }, { status: 201 })
  )
  render(<CompanySetup onCreated={vi.fn()} onConflict={async () => false} onSignOut={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Company name'), {
    target: { value: 'Wayne Enterprises' },
  })
  fireEvent.change(screen.getByLabelText('Week starts on'), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'America/New_York' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create company' }))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(await sentBodies(requests)).toContain(
    JSON.stringify({
      name: 'Wayne Enterprises',
      weekStartsOn: 0,
      timeZone: 'America/New_York',
    })
  )
})

it('accepts 100 astral name characters and refuses 101 without truncating', async () => {
  const { fetch, requests } = stubFetch(() =>
    Response.json({ companyId: 'wayne' }, { status: 201 })
  )
  render(<CompanySetup onCreated={vi.fn()} onConflict={async () => false} onSignOut={vi.fn()} />)
  const name = screen.getByLabelText('Company name')
  expect(name).not.toHaveAttribute('maxlength')
  fireEvent.change(name, { target: { value: '𐐀'.repeat(101) } })
  fireEvent.click(screen.getByRole('button', { name: 'Create company' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.change(name, { target: { value: '𐐀'.repeat(100) } })
  fireEvent.click(screen.getByRole('button', { name: 'Create company' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  expect(await sentBodies(requests)).toContain(
    JSON.stringify({ name: '𐐀'.repeat(100), weekStartsOn: 1, timeZone: 'Etc/GMT' })
  )
})
