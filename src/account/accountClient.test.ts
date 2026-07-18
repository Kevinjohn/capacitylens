import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue(new Response(null, { status: 204 })),
  apiFetchReauth: vi.fn<(url: string, init?: RequestInit, timeout?: number) => Promise<Response>>()
    .mockResolvedValue(new Response(null, { status: 204 })),
  requestSignal: vi.fn((signal?: AbortSignal) => signal),
}))

vi.mock('../data/apiConfig', () => ({ API_BASE: 'https://app.example' }))
vi.mock('../data/requestTimeout', () => ({
  apiFetch: mocks.apiFetch,
  API_BULK_TIMEOUT_MS: 120_000,
  requestSignal: mocks.requestSignal,
}))
vi.mock('../auth/apiFetchReauth', () => ({ apiFetchReauth: mocks.apiFetchReauth }))

import {
  accountClient,
  accountCommandOutcomeUnknown,
  newBrowserAccountCommand,
} from './accountClient'

const command = { commandId: 'command-1', idempotencyKey: 'key-1' }

function expectCommand(init: RequestInit, method: string): void {
  expect(init.method).toBe(method)
  const headers = new Headers(init.headers)
  expect(headers.get('idempotency-key')).toBe(command.idempotencyKey)
  expect(headers.get('x-account-command-id')).toBe(command.commandId)
}

describe('browser account client', () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset().mockImplementation(
      () => Promise.resolve(new Response(null, { status: 204 })),
    )
    mocks.apiFetchReauth.mockReset().mockImplementation(
      () => Promise.resolve(new Response(null, { status: 204 })),
    )
    mocks.requestSignal.mockClear()
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('creates independent command and idempotency secrets', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000000')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
    expect(newBrowserAccountCommand()).toEqual({
      commandId: '00000000-0000-4000-8000-000000000000',
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
    })
  })

  it('owns unauthenticated status and workspace-list reads', async () => {
    const response = new Response('[]')
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await accountClient.me(controller.signal)
    await accountClient.listWorkspaces(controller.signal)

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://app.example/api/auth/me', {
      credentials: 'include',
      signal: controller.signal,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://app.example/api/accounts', {
      credentials: 'include',
      signal: controller.signal,
    })
  })

  it('adds command headers, JSON encoding, safe path encoding, reauth, and bulk timeout policy', async () => {
    await accountClient.createWorkspace({ name: 'Studio' }, command)
    await accountClient.eraseWorkspace('workspace / one', command)
    await accountClient.changeMemberRole('workspace / one', 'person / one', 'editor', command)
    await accountClient.removeMember('workspace / one', 'person / one', command)
    await accountClient.transferOwnership('workspace / one', 'person / one', command)
    await accountClient.issuePasswordReset('workspace / one', 'person / one', command)
    await accountClient.revokeMemberSessions('workspace / one', 'person / one', command)
    await accountClient.createInvitation({ accountId: 'workspace / one', role: 'viewer' }, command)
    await accountClient.revokeInvitation('workspace / one', 'invite / one', command)

    const [createUrl, createInit] = mocks.apiFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(createUrl).toBe('https://app.example/api/orgs')
    expectCommand(createInit, 'POST')
    expect(new Headers(createInit.headers).get('content-type')).toBe('application/json')
    expect(createInit.body).toBe(JSON.stringify({ name: 'Studio' }))

    const [eraseUrl, eraseInit, eraseTimeout] = mocks.apiFetchReauth.mock.calls[0] as unknown as [string, RequestInit, number]
    expect(eraseUrl).toBe('https://app.example/api/accounts/workspace%20%2F%20one')
    expectCommand(eraseInit, 'DELETE')
    expect(eraseTimeout).toBe(120_000)

    const urls = mocks.apiFetchReauth.mock.calls.map((call) => String(call[0]))
    expect(urls).toEqual(expect.arrayContaining([
      'https://app.example/api/accounts/workspace%20%2F%20one/members/person%20%2F%20one',
      'https://app.example/api/accounts/workspace%20%2F%20one/transfer-ownership',
      'https://app.example/api/accounts/workspace%20%2F%20one/members/person%20%2F%20one/reset-password',
      'https://app.example/api/accounts/workspace%20%2F%20one/members/person%20%2F%20one/revoke-sessions',
      'https://app.example/api/accounts/workspace%20%2F%20one/invites/invite%20%2F%20one',
    ]))
  })

  it('owns member, invitation preview, acceptance, and signup routes', async () => {
    await accountClient.listMembers('workspace / one')
    await accountClient.listInvitations('workspace / one')
    await accountClient.previewInvitation('token / one')
    await accountClient.acceptInvitation('token / one', command)
    await accountClient.signupWithInvitation('token / one', { name: 'New user' }, command)

    const privilegedUrls = mocks.apiFetchReauth.mock.calls.map((call) => String(call[0]))
    expect(privilegedUrls).toEqual([
      'https://app.example/api/accounts/workspace%20%2F%20one/members',
      'https://app.example/api/accounts/workspace%20%2F%20one/invites',
    ])
    const urls = mocks.apiFetch.mock.calls.map((call) => String(call[0]))
    expect(urls).toEqual([
      'https://app.example/api/invites/token%20%2F%20one/preview',
      'https://app.example/api/invites/token%20%2F%20one/accept',
      'https://app.example/api/invites/token%20%2F%20one/signup',
    ])
    expectCommand(mocks.apiFetch.mock.calls[1]![1]!, 'POST')
    expectCommand(mocks.apiFetch.mock.calls[2]![1]!, 'POST')
  })

  it('keeps reconciliation bearers out of the URL', async () => {
    await accountClient.reconcileCommand(command, 'password-reset')

    const [url, init] = mocks.apiFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://app.example/api/account-commands/reconcile')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      operation: 'password-reset',
    })
    expect(url).not.toContain(command.commandId)
    expect(url).not.toContain(command.idempotencyKey)
  })

  it('reuses a stored command across unknown outcomes and rotates it after terminal completion', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000004')
    mocks.apiFetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await accountClient.createWorkspace({ name: 'Studio' })
    await accountClient.createWorkspace({ name: 'Studio' })
    await accountClient.createWorkspace({ name: 'Studio' })

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'))
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
    ])
  })

  it('keeps a command after an in-progress conflict but clears it after an idempotency conflict', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000004')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000005')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000006')
    mocks.apiFetch
      .mockResolvedValueOnce(Response.json({ code: 'COMMAND_IN_PROGRESS' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ code: 'IDEMPOTENCY_CONFLICT' }, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await accountClient.createWorkspace({ name: 'Studio' })
    await accountClient.createWorkspace({ name: 'Studio' })
    await accountClient.createWorkspace({ name: 'Studio' })

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'))
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000005',
    ])
  })

  it('does not let an explicit command discard an implicit unknown-outcome ceremony', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000031')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000032')
    mocks.apiFetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await accountClient.createWorkspace({ name: 'Studio' })
    await accountClient.createWorkspace({ name: 'Studio' }, command)
    await accountClient.createWorkspace({ name: 'Studio' })

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'))
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000031',
      command.commandId,
      '00000000-0000-4000-8000-000000000031',
    ])
  })

  it('keeps unknown-outcome ceremonies separate for different semantic payloads', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000011')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000012')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000013')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000014')
    mocks.apiFetch.mockResolvedValue(new Response(null, { status: 503 }))

    await accountClient.createWorkspace({ name: 'Studio A' })
    await accountClient.createWorkspace({ name: 'Studio B' })
    await accountClient.createWorkspace({ name: 'Studio A' })

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'))
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000013',
      '00000000-0000-4000-8000-000000000011',
    ])
  })

  it('treats object key order as irrelevant when binding a semantic payload', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000021')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000022')
    mocks.apiFetch.mockResolvedValue(new Response(null, { status: 503 }))

    await accountClient.createWorkspace({ name: 'Studio', color: '#fff' })
    await accountClient.createWorkspace({ color: '#fff', name: 'Studio' })

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'))
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000021',
    ])
  })

  it('classifies server and in-progress responses as unknown without consuming the body', async () => {
    const inProgress = Response.json({ code: 'COMMAND_IN_PROGRESS', error: 'Still running.' }, { status: 409 })
    await expect(accountCommandOutcomeUnknown(inProgress)).resolves.toBe(true)
    await expect(inProgress.json()).resolves.toMatchObject({ error: 'Still running.' })
    await expect(accountCommandOutcomeUnknown(new Response(null, { status: 503 }))).resolves.toBe(true)
    await expect(accountCommandOutcomeUnknown(
      Response.json({ code: 'IDEMPOTENCY_CONFLICT' }, { status: 409 }),
    )).resolves.toBe(false)
  })
})
