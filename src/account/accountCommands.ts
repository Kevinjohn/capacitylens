import { isAccountCommandId, isAccountIdempotencyKey } from "@capacitylens/shared/account/validation";

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

function commandStorageKey(operationKey: string): string {
  // Cleanup is best-effort because sessionStorage can fail partway through an identity change.
  // Keep the identity in the lookup coordinate as the backstop: a surviving old handle can only
  // ever be recovered by the same authenticated principal.
  return `${COMMAND_STORAGE_PREFIX}${activeCommandIdentity ?? "unbound"}.${operationKey}`;
}

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

export function storedCommand(operationKey: string): BrowserAccountCommand {
  const storageKey = commandStorageKey(operationKey);
  const memoryCommand = memoryCommands.get(storageKey);
  if (memoryCommand) return memoryCommand;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as Partial<BrowserAccountCommand> | null;
    if (parsed && isAccountCommandId(parsed.commandId) && isAccountIdempotencyKey(parsed.idempotencyKey)) {
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

export function clearStoredCommand(operationKey: string): void {
  const storageKey = commandStorageKey(operationKey);
  memoryCommands.delete(storageKey);
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // A completed server command is authoritative even when browser storage cleanup is blocked.
  }
}
