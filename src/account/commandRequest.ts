import {
  createBrowserAccountCommand,
  readOrCreateStoredCommand,
  clearStoredCommand,
  type BrowserAccountCommand,
} from "./accountCommands";
import { readUnknownAccountCommandOutcome, unknownCommandOutcomes } from "./commandOutcome";

interface RunCommandInput {
  operationKey: string | null;
  explicit: BrowserAccountCommand | undefined;
  request: (command: BrowserAccountCommand) => Promise<Response>;
  ambiguousStatus?: number | undefined;
}

export async function runCommand({
  operationKey,
  explicit,
  request,
  ambiguousStatus,
}: RunCommandInput): Promise<Response> {
  const command =
    explicit ?? (operationKey === null ? createBrowserAccountCommand() : readOrCreateStoredCommand(operationKey));
  const response = await request(command);
  // A transport failure, HTTP 408, 5xx or ambiguous 409 has an unknown commit outcome, so retain
  // the same command. A definitive success or decoded known caller/policy rejection closes it.
  const outcomeUnknown = response.status === ambiguousStatus || (await readUnknownAccountCommandOutcome(response));
  if (outcomeUnknown) unknownCommandOutcomes.add(response);
  const terminalCallerFailure = response.status >= 400 && response.status < 500 && !outcomeUnknown;
  // An explicit command is caller-owned and must never discard an older implicit ceremony for the
  // same operation. Only the implicit command loaded from session storage may close that record.
  if (explicit === undefined && operationKey !== null && (response.ok || terminalCallerFailure)) {
    clearStoredCommand(operationKey);
  }
  return response;
}

export function buildCommandRequestInit(
  requestOptions: RequestInit,
  command = createBrowserAccountCommand(),
): RequestInit {
  const headers = new Headers(requestOptions.headers);
  headers.set("Idempotency-Key", command.idempotencyKey);
  headers.set("X-Account-Command-Id", command.commandId);
  return { ...requestOptions, headers };
}

export function buildJsonCommandRequestInit(
  // DELETE carries a body for exactly one caller: the ceremony cancellation, whose expected
  // revision is the compare half of a transition rather than an identifier, so it belongs in the
  // payload the server hashes — not in the path.
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  command?: BrowserAccountCommand,
): RequestInit {
  const headers = new Headers({ "Content-Type": "application/json" });
  return buildCommandRequestInit({ method, credentials: "include", headers, body: JSON.stringify(body) }, command);
}
