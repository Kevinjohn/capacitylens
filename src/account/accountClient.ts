import { apiFetchReauth } from "../auth/apiFetchReauth";
import { API_BASE } from "../data/apiConfig";
import { apiFetch, API_BULK_TIMEOUT_MS, requestSignal } from "../data/requestTimeout";
import type { AccountErrorCode } from "@capacitylens/shared/account/errors";

export interface BrowserAccountCommand {
  commandId: string;
  idempotencyKey: string;
}

export function newBrowserAccountCommand(): BrowserAccountCommand {
  return {
    commandId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  };
}

const COMMAND_STORAGE_PREFIX = "capacitylens.account-command.";
const COMMAND_IDENTITY_STORAGE_KEY = `${COMMAND_STORAGE_PREFIX}identity`;
// sessionStorage can be unavailable in hardened/private browser contexts. Keep the current page's
// retry ceremony in memory as the minimum safe fallback; successful storage still extends it across
// reloads for the lifetime of the tab.
const memoryCommands = new Map<string, BrowserAccountCommand>();
let activeCommandIdentity: string | undefined;

/** End every implicit account-command ceremony owned by the identity leaving this browser tab.
 * sessionStorage survives a reload, so sign-out must explicitly remove these handles before a
 * different identity can use the same tab. Unrelated per-tab preferences remain intact. */
export function clearStoredAccountCommands(): void {
  memoryCommands.clear();
  activeCommandIdentity = undefined;
  let keys: string[];
  try {
    keys = Array.from({ length: sessionStorage.length }, (_unused, index) => sessionStorage.key(index)).filter(
      (key): key is string => key?.startsWith(COMMAND_STORAGE_PREFIX) === true,
    );
  } catch (error) {
    console.error("Account command storage could not be inspected during sign-out", error);
    return;
  }
  for (const key of keys) {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.error("An account command could not be cleared during sign-out", error);
    }
  }
}

/** Bind implicit retry ceremonies to the authenticated principal verified by `/api/auth/me`.
 * A same-user reload keeps its unknown-outcome recovery handle. A missing legacy owner or a
 * different principal clears every bearer before the authenticated application is rendered. */
export function bindStoredAccountCommandsToIdentity(identity: string): void {
  let storedIdentity: string | null = null;
  try {
    storedIdentity = sessionStorage.getItem(COMMAND_IDENTITY_STORAGE_KEY);
  } catch {
    // The in-memory identity below still protects identity changes during this page lifetime.
  }
  const previousIdentity = activeCommandIdentity ?? storedIdentity ?? undefined;
  if (previousIdentity !== identity) clearStoredAccountCommands();
  activeCommandIdentity = identity;
  try {
    sessionStorage.setItem(COMMAND_IDENTITY_STORAGE_KEY, identity);
  } catch {
    // Hardened browser contexts retain only the page-lifetime identity and command maps.
  }
}

// Only these currently defined 409 codes prove that the server reached a terminal rejection. A
// new or malformed code stays unknown until it is deliberately classified here, preserving the
// sole retry/reconciliation handle rather than risking a second semantic command.
const TERMINAL_COMMAND_CONFLICT_CODES = new Set<string>([
  "INVITATION_USED",
  "CONFLICT",
  "AUTHORITY_CHANGED",
  "IDEMPOTENCY_CONFLICT",
] satisfies readonly AccountErrorCode[]);

function compareCanonicalKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Keep unknown-outcome retry ceremonies distinct when one UI operation accepts different
 * semantic payloads. Without this binding, changing (for example) the workspace name after a 5xx
 * reuses the old command, receives IDEMPOTENCY_CONFLICT, clears the only recovery handle, and can
 * then submit a fresh duplicate while the original outcome is still unknown. */
async function payloadOperationKey(operation: string, body: unknown): Promise<string> {
  const canonical =
    JSON.stringify(body, (_key, value: unknown) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareCanonicalKeys(left, right)),
      );
    }) ?? "null";
  const bytes = new TextEncoder().encode(canonical);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const fingerprint = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${operation}:${fingerprint}`;
}

/** HTTP responses for which the client cannot prove whether a command committed. */
export async function accountCommandOutcomeUnknown(response: Response, parsedBody?: unknown): Promise<boolean> {
  if (response.status === 408 || response.status >= 500) return true;
  if (response.status !== 409) return false;
  try {
    const body: unknown =
      parsedBody === undefined
        ? await (typeof response.clone === "function" ? response.clone() : response).json()
        : parsedBody;
    if (typeof body !== "object" || body === null || !("code" in body)) return true;
    const code = (body as { code?: unknown }).code;
    return typeof code !== "string" || !TERMINAL_COMMAND_CONFLICT_CODES.has(code);
  } catch {
    // Status alone cannot distinguish a terminal rejection from an in-flight command. Retain the
    // identity unless a readable, known code proves finality.
    return true;
  }
}

function storedCommand(operationKey: string): BrowserAccountCommand {
  const storageKey = `${COMMAND_STORAGE_PREFIX}${operationKey}`;
  const memoryCommand = memoryCommands.get(storageKey);
  if (memoryCommand) return memoryCommand;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as Partial<BrowserAccountCommand> | null;
    if (
      parsed &&
      typeof parsed.commandId === "string" &&
      typeof parsed.idempotencyKey === "string" &&
      /^[A-Za-z0-9_-]{16,128}$/.test(parsed.commandId) &&
      /^[A-Za-z0-9_-]{16,128}$/.test(parsed.idempotencyKey)
    ) {
      const command = {
        commandId: parsed.commandId,
        idempotencyKey: parsed.idempotencyKey,
      };
      memoryCommands.set(storageKey, command);
      return command;
    }
  } catch {
    // A corrupt browser cache is not authoritative; replace it with a fresh opaque command.
  }
  const created = newBrowserAccountCommand();
  memoryCommands.set(storageKey, created);
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(created));
  } catch {
    // The module-level fallback retains this implicit ceremony until a terminal outcome.
  }
  return created;
}

function clearStoredCommand(operationKey: string): void {
  const storageKey = `${COMMAND_STORAGE_PREFIX}${operationKey}`;
  memoryCommands.delete(storageKey);
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // A completed server command is authoritative even when browser storage cleanup is blocked.
  }
}

async function runCommand(
  operationKey: string | null,
  explicit: BrowserAccountCommand | undefined,
  request: (command: BrowserAccountCommand) => Promise<Response>,
  ambiguousStatus?: number,
): Promise<Response> {
  const command = explicit ?? (operationKey === null ? newBrowserAccountCommand() : storedCommand(operationKey));
  const response = await request(command);
  // A transport failure, HTTP 408, 5xx or ambiguous 409 has an unknown commit outcome, so retain
  // the same command. A definitive success or decoded known caller/policy rejection closes it.
  const outcomeUnknown = response.status === ambiguousStatus || (await accountCommandOutcomeUnknown(response));
  const terminalCallerFailure = response.status >= 400 && response.status < 500 && !outcomeUnknown;
  // An explicit command is caller-owned and must never discard an older implicit ceremony for the
  // same operation. Only the implicit command loaded from session storage may close that record.
  if (explicit === undefined && operationKey !== null && (response.ok || terminalCallerFailure)) {
    clearStoredCommand(operationKey);
  }
  return response;
}

function commandInit(init: RequestInit, command = newBrowserAccountCommand()): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Idempotency-Key", command.idempotencyKey);
  headers.set("X-Account-Command-Id", command.commandId);
  return { ...init, headers };
}

function jsonCommandInit(method: "POST" | "PATCH", body: unknown, command?: BrowserAccountCommand): RequestInit {
  const headers = new Headers({ "Content-Type": "application/json" });
  return commandInit({ method, credentials: "include", headers, body: JSON.stringify(body) }, command);
}

export const accountClient = {
  me(signal?: AbortSignal): Promise<Response> {
    return fetch(`${API_BASE}/api/auth/me`, {
      credentials: "include",
      signal: requestSignal(signal),
    });
  },

  listWorkspaces(signal?: AbortSignal): Promise<Response> {
    return fetch(`${API_BASE}/api/accounts`, {
      credentials: "include",
      signal: requestSignal(signal),
    });
  },

  signOut(): Promise<Response> {
    return apiFetch(`${API_BASE}/api/account/sign-out`, {
      method: "POST",
      credentials: "include",
    });
  },

  listSessions(): Promise<Response> {
    return apiFetch(`${API_BASE}/api/account/sessions`, {
      credentials: "include",
    });
  },

  revokeOwnSession(sessionId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(`own-session:${sessionId}`, command, (resolved) =>
      apiFetch(
        `${API_BASE}/api/account/sessions/${encodeURIComponent(sessionId)}`,
        commandInit({ method: "DELETE", credentials: "include" }, resolved),
      ),
    );
  },

  async createWorkspace(body: unknown, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(await payloadOperationKey("workspace-create", body), command, (resolved) =>
      apiFetch(`${API_BASE}/api/orgs`, jsonCommandInit("POST", body, resolved)),
    );
  },

  eraseWorkspace(workspaceId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(
      `workspace-erase:${workspaceId}`,
      command,
      (resolved) =>
        apiFetchReauth(
          `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}`,
          commandInit({ method: "DELETE", credentials: "include" }, resolved),
          API_BULK_TIMEOUT_MS,
        ),
      403,
    );
  },

  listMembers(workspaceId: string): Promise<Response> {
    return apiFetchReauth(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members`, {
      credentials: "include",
    });
  },

  listInvitations(workspaceId: string): Promise<Response> {
    return apiFetchReauth(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/invites`, {
      credentials: "include",
    });
  },

  changeMemberRole(
    workspaceId: string,
    principalId: string,
    role: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand(`member-role:${workspaceId}:${principalId}:${role}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}`,
        jsonCommandInit("PATCH", { role }, resolved),
      ),
    );
  },

  removeMember(workspaceId: string, principalId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(`member-remove:${workspaceId}:${principalId}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}`,
        commandInit({ method: "DELETE", credentials: "include" }, resolved),
      ),
    );
  },

  transferOwnership(
    workspaceId: string,
    targetPrincipalId: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand(`ownership-transfer:${workspaceId}:${targetPrincipalId}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/transfer-ownership`,
        jsonCommandInit("POST", { toUserId: targetPrincipalId }, resolved),
      ),
    );
  },

  issuePasswordReset(workspaceId: string, principalId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(`password-reset:${workspaceId}:${principalId}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/reset-password`,
        commandInit({ method: "POST", credentials: "include" }, resolved),
      ),
    );
  },

  revokeMemberSessions(workspaceId: string, principalId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(`member-sessions:${workspaceId}:${principalId}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/revoke-sessions`,
        commandInit({ method: "POST", credentials: "include" }, resolved),
      ),
    );
  },

  async createInvitation(body: unknown, command?: BrowserAccountCommand): Promise<Response> {
    const accountId =
      typeof body === "object" && body !== null && "accountId" in body
        ? String((body as { accountId: unknown }).accountId)
        : "unknown";
    return runCommand(await payloadOperationKey(`invitation-create:${accountId}`, body), command, (resolved) =>
      apiFetchReauth(`${API_BASE}/api/invites`, jsonCommandInit("POST", body, resolved)),
    );
  },

  revokeInvitation(workspaceId: string, invitationId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(`invitation-revoke:${workspaceId}:${invitationId}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(invitationId)}`,
        commandInit({ method: "DELETE", credentials: "include" }, resolved),
      ),
    );
  },

  previewInvitation(token: string): Promise<Response> {
    return apiFetch(`${API_BASE}/api/invites/${encodeURIComponent(token)}/preview`, {
      credentials: "include",
    });
  },

  acceptInvitation(token: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(null, command, (resolved) =>
      apiFetch(
        `${API_BASE}/api/invites/${encodeURIComponent(token)}/accept`,
        commandInit({ method: "POST", credentials: "include" }, resolved),
      ),
    );
  },

  signupWithInvitation(token: string, body: unknown, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(null, command, (resolved) =>
      apiFetch(`${API_BASE}/api/invites/${encodeURIComponent(token)}/signup`, jsonCommandInit("POST", body, resolved)),
    );
  },

  reconcileCommand(command: BrowserAccountCommand, operation: string): Promise<Response> {
    return apiFetch(`${API_BASE}/api/account-commands/reconcile`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        operation,
      }),
    });
  },
};
