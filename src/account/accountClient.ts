import { apiFetchReauth } from '../auth/apiFetchReauth'
import { API_BASE } from '../data/apiConfig'
import { apiFetch, API_BULK_TIMEOUT_MS, requestSignal } from '../data/requestTimeout'

export interface BrowserAccountCommand {
  commandId: string
  idempotencyKey: string
}

export function newBrowserAccountCommand(): BrowserAccountCommand {
  return { commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }
}

const COMMAND_STORAGE_PREFIX = 'capacitylens.account-command.'

function compareCanonicalKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Keep unknown-outcome retry ceremonies distinct when one UI operation accepts different
 * semantic payloads. Without this binding, changing (for example) the workspace name after a 5xx
 * reuses the old command, receives IDEMPOTENCY_CONFLICT, clears the only recovery handle, and can
 * then submit a fresh duplicate while the original outcome is still unknown. */
async function payloadOperationKey(operation: string, body: unknown): Promise<string> {
  const canonical = JSON.stringify(body, (_key, value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
        compareCanonicalKeys(left, right)),
    )
  }) ?? 'null'
  const bytes = new TextEncoder().encode(canonical)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const fingerprint = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${operation}:${fingerprint}`
}

/** HTTP responses for which the client cannot prove whether a command committed. */
export async function accountCommandOutcomeUnknown(response: Response): Promise<boolean> {
  if (response.status >= 500) return true
  if (response.status !== 409) return false
  const readable = typeof response.clone === 'function' ? response.clone() : response
  const body = await readable.json().catch(() => null) as { code?: unknown } | null
  return body?.code === 'COMMAND_IN_PROGRESS'
}

function storedCommand(operationKey: string): BrowserAccountCommand {
  const storageKey = `${COMMAND_STORAGE_PREFIX}${operationKey}`
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Partial<BrowserAccountCommand> | null
    if (
      parsed &&
      typeof parsed.commandId === 'string' &&
      typeof parsed.idempotencyKey === 'string' &&
      /^[A-Za-z0-9_-]{16,128}$/.test(parsed.commandId) &&
      /^[A-Za-z0-9_-]{16,128}$/.test(parsed.idempotencyKey)
    ) return { commandId: parsed.commandId, idempotencyKey: parsed.idempotencyKey }
  } catch {
    // A corrupt browser cache is not authoritative; replace it with a fresh opaque command.
  }
  const created = newBrowserAccountCommand()
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(created))
  } catch {
    // Memory-only retry remains available through an explicitly supplied command.
  }
  return created
}

function clearStoredCommand(operationKey: string): void {
  try {
    sessionStorage.removeItem(`${COMMAND_STORAGE_PREFIX}${operationKey}`)
  } catch {
    // A completed server command is authoritative even when browser storage cleanup is blocked.
  }
}

async function runCommand(
  operationKey: string | null,
  explicit: BrowserAccountCommand | undefined,
  request: (command: BrowserAccountCommand) => Promise<Response>,
): Promise<Response> {
  const command = explicit ?? (operationKey === null ? newBrowserAccountCommand() : storedCommand(operationKey))
  const response = await request(command)
  // A transport failure or 5xx has an unknown commit outcome, so retain the same command. A
  // definitive success or caller/policy rejection closes the browser retry ceremony.
  const outcomeUnknown = await accountCommandOutcomeUnknown(response)
  const terminalCallerFailure = response.status >= 400 && response.status < 500 && !outcomeUnknown
  // An explicit command is caller-owned and must never discard an older implicit ceremony for the
  // same operation. Only the implicit command loaded from session storage may close that record.
  if (explicit === undefined && operationKey !== null && (response.ok || terminalCallerFailure)) {
    clearStoredCommand(operationKey)
  }
  return response
}

function commandInit(init: RequestInit, command = newBrowserAccountCommand()): RequestInit {
  const headers = new Headers(init.headers)
  headers.set('Idempotency-Key', command.idempotencyKey)
  headers.set('X-Account-Command-Id', command.commandId)
  return { ...init, headers }
}

function jsonCommandInit(
  method: 'POST' | 'PATCH',
  body: unknown,
  command?: BrowserAccountCommand,
): RequestInit {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  return commandInit({ method, credentials: 'include', headers, body: JSON.stringify(body) }, command)
}

export const accountClient = {
  me(signal?: AbortSignal): Promise<Response> {
    return fetch(`${API_BASE}/api/auth/me`, {
      credentials: 'include',
      signal: requestSignal(signal),
    })
  },

  listWorkspaces(signal?: AbortSignal): Promise<Response> {
    return fetch(`${API_BASE}/api/accounts`, {
      credentials: 'include',
      signal: requestSignal(signal),
    })
  },

  signOut(): Promise<Response> {
    return apiFetch(`${API_BASE}/api/account/sign-out`, {
      method: 'POST',
      credentials: 'include',
    })
  },

  listSessions(): Promise<Response> {
    return apiFetch(`${API_BASE}/api/account/sessions`, { credentials: 'include' })
  },

  revokeOwnSession(sessionId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(`own-session:${sessionId}`, command, (resolved) => apiFetch(
      `${API_BASE}/api/account/sessions/${encodeURIComponent(sessionId)}`,
      commandInit({ method: 'DELETE', credentials: 'include' }, resolved),
    ))
  },

  async createWorkspace(body: unknown, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(await payloadOperationKey('workspace-create', body), command, (resolved) =>
      apiFetch(`${API_BASE}/api/orgs`, jsonCommandInit('POST', body, resolved)))
  },

  eraseWorkspace(workspaceId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(`workspace-erase:${workspaceId}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}`,
        commandInit({ method: 'DELETE', credentials: 'include' }, resolved),
        API_BULK_TIMEOUT_MS,
      ))
  },

  listMembers(workspaceId: string): Promise<Response> {
    return apiFetchReauth(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members`, {
      credentials: 'include',
    })
  },

  listInvitations(workspaceId: string): Promise<Response> {
    return apiFetchReauth(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/invites`, {
      credentials: 'include',
    })
  },

  changeMemberRole(
    workspaceId: string,
    principalId: string,
    role: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand(`member-role:${workspaceId}:${principalId}:${role}`, command, (resolved) => apiFetchReauth(
      `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}`,
      jsonCommandInit('PATCH', { role }, resolved),
    ))
  },

  removeMember(
    workspaceId: string,
    principalId: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand(`member-remove:${workspaceId}:${principalId}`, command, (resolved) => apiFetchReauth(
      `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}`,
      commandInit({ method: 'DELETE', credentials: 'include' }, resolved),
    ))
  },

  transferOwnership(
    workspaceId: string,
    targetPrincipalId: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand(`ownership-transfer:${workspaceId}:${targetPrincipalId}`, command, (resolved) => apiFetchReauth(
      `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/transfer-ownership`,
      jsonCommandInit('POST', { toUserId: targetPrincipalId }, resolved),
    ))
  },

  issuePasswordReset(
    workspaceId: string,
    principalId: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand(`password-reset:${workspaceId}:${principalId}`, command, (resolved) => apiFetchReauth(
      `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/reset-password`,
      commandInit({ method: 'POST', credentials: 'include' }, resolved),
    ))
  },

  revokeMemberSessions(
    workspaceId: string,
    principalId: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand(`member-sessions:${workspaceId}:${principalId}`, command, (resolved) => apiFetchReauth(
      `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/revoke-sessions`,
      commandInit({ method: 'POST', credentials: 'include' }, resolved),
    ))
  },

  async createInvitation(body: unknown, command?: BrowserAccountCommand): Promise<Response> {
    const accountId = typeof body === 'object' && body !== null && 'accountId' in body
      ? String((body as { accountId: unknown }).accountId)
      : 'unknown'
    return runCommand(await payloadOperationKey(`invitation-create:${accountId}`, body), command, (resolved) =>
      apiFetchReauth(`${API_BASE}/api/invites`, jsonCommandInit('POST', body, resolved)))
  },

  revokeInvitation(
    workspaceId: string,
    invitationId: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand(`invitation-revoke:${workspaceId}:${invitationId}`, command, (resolved) => apiFetchReauth(
      `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(invitationId)}`,
      commandInit({ method: 'DELETE', credentials: 'include' }, resolved),
    ))
  },

  previewInvitation(token: string): Promise<Response> {
    return apiFetch(`${API_BASE}/api/invites/${encodeURIComponent(token)}/preview`, {
      credentials: 'include',
    })
  },

  acceptInvitation(token: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(null, command, (resolved) => apiFetch(
      `${API_BASE}/api/invites/${encodeURIComponent(token)}/accept`,
      commandInit({ method: 'POST', credentials: 'include' }, resolved),
    ))
  },

  signupWithInvitation(
    token: string,
    body: unknown,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand(null, command, (resolved) => apiFetch(
      `${API_BASE}/api/invites/${encodeURIComponent(token)}/signup`,
      jsonCommandInit('POST', body, resolved),
    ))
  },

  reconcileCommand(command: BrowserAccountCommand, operation: string): Promise<Response> {
    return apiFetch(
      `${API_BASE}/api/account-commands/reconcile`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          operation,
        }),
      },
    )
  },
}
