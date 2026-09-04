import {
  newBrowserAccountCommand,
  storedCommand,
  clearStoredCommand,
  type BrowserAccountCommand,
} from "./accountCommands";
import { accountCommandOutcomeUnknown, unknownCommandOutcomes } from "./commandOutcome";

export async function runCommand(
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
  if (outcomeUnknown) unknownCommandOutcomes.add(response);
  const terminalCallerFailure = response.status >= 400 && response.status < 500 && !outcomeUnknown;
  // An explicit command is caller-owned and must never discard an older implicit ceremony for the
  // same operation. Only the implicit command loaded from session storage may close that record.
  if (explicit === undefined && operationKey !== null && (response.ok || terminalCallerFailure)) {
    clearStoredCommand(operationKey);
  }
  return response;
}

export function commandInit(init: RequestInit, command = newBrowserAccountCommand()): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Idempotency-Key", command.idempotencyKey);
  headers.set("X-Account-Command-Id", command.commandId);
  return { ...init, headers };
}

export function jsonCommandInit(method: "POST" | "PATCH", body: unknown, command?: BrowserAccountCommand): RequestInit {
  const headers = new Headers({ "Content-Type": "application/json" });
  return commandInit({ method, credentials: "include", headers, body: JSON.stringify(body) }, command);
}
