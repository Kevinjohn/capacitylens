import { MAX_RATE_LIMIT, normalizeRateLimit } from "../rateLimit";
import { DEFAULT_ACCOUNT_APPLICATION } from "../auth";
import { boundApplicationFailure } from "@capacitylens/shared/account/validation";
import { createNoopAuditSink } from "../audit";
import { runImportWorker } from "../runImportWorker";
import { MIN_BOOTSTRAP_TOKEN_BYTES } from "./appLimits";
import type { AppOptions } from "../app";

/** Restricts cross-origin browser calls to local development and test origins by default.
 * The application factory uses this value when corsOrigin is omitted.
 */
export const DEFAULT_CORS = "http://localhost:5173,http://localhost:5273,http://127.0.0.1:5173,http://127.0.0.1:5273";

function assertAppOptions(options: AppOptions, rateLimitMax: number): void {
  const configuredRateLimit = options.rateLimit ?? 0;
  if (configuredRateLimit !== 0 && rateLimitMax === 0) {
    throw new RangeError(
      `rateLimit must be 0 (disabled) or a positive integer no greater than ${MAX_RATE_LIMIT.toLocaleString("en-US")}.`,
    );
  }
  if ((options.authMode ?? "off") !== "off" && !options.auth) {
    throw new Error(`buildApp: authMode '${options.authMode}' requires a Better Auth instance (opts.auth)`);
  }
  if (options.bootstrapToken && Buffer.byteLength(options.bootstrapToken, "utf8") < MIN_BOOTSTRAP_TOKEN_BYTES) {
    throw new Error(`CAPACITYLENS_BOOTSTRAP_TOKEN must be at least ${MIN_BOOTSTRAP_TOKEN_BYTES} bytes.`);
  }
}

/** Resolves application options and validates deployment-sensitive configuration. */
export function resolveAppConfig(options: AppOptions) {
  const authMode = options.authMode ?? "off";
  const auth = options.auth ?? null;
  const configuredRateLimit = options.rateLimit ?? 0;
  const rateLimitMax = normalizeRateLimit(configuredRateLimit);
  // Misconfiguration, not a request-time condition: fail at construction, loudly.
  assertAppOptions(options, rateLimitMax);
  const application = options.application ?? DEFAULT_ACCOUNT_APPLICATION;
  const applicationFailure = boundApplicationFailure(application);
  if (applicationFailure) throw new Error(`buildApp: ${applicationFailure}`);
  const executeImportWorker = options.importWorker ?? runImportWorker;
  // One fail-never sink receives both legacy product mutation records and normalized account-flow
  // events. Construct it before the account boundary so the coordinator, not its HTTP caller, owns
  // audit correlation for cross-port commands.
  const auditSink = options.audit ?? createNoopAuditSink();
  const logOn = options.log === true;
  return { authMode, auth, rateLimitMax, application, executeImportWorker, auditSink, logOn };
}
