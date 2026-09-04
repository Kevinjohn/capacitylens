import { MAX_RATE_LIMIT, normalizeRateLimit } from "../rateLimit";
import { DEFAULT_ACCOUNT_APPLICATION } from "../auth";
import { boundApplicationFailure } from "@capacitylens/shared/account/validation";
import { noopAuditSink } from "../audit";
import { runImportWorker } from "../runImportWorker";
import { MIN_BOOTSTRAP_TOKEN_BYTES } from "./appLimits";
import type { AppOptions } from "../app";

export function resolveAppConfig(opts: AppOptions) {
  const authMode = opts.authMode ?? "off";
  const auth = opts.auth ?? null;
  const configuredRateLimit = opts.rateLimit ?? 0;
  const rateLimitMax = normalizeRateLimit(configuredRateLimit);
  if (configuredRateLimit !== 0 && rateLimitMax === 0) {
    throw new RangeError(
      `rateLimit must be 0 (disabled) or a positive integer no greater than ${MAX_RATE_LIMIT.toLocaleString("en-US")}.`,
    );
  }
  // Misconfiguration, not a request-time condition: fail at construction, loudly.
  if (authMode !== "off" && !auth) {
    throw new Error(`buildApp: authMode '${authMode}' requires a Better Auth instance (opts.auth)`);
  }
  if (opts.bootstrapToken && Buffer.byteLength(opts.bootstrapToken, "utf8") < MIN_BOOTSTRAP_TOKEN_BYTES) {
    throw new Error(`CAPACITYLENS_BOOTSTRAP_TOKEN must be at least ${MIN_BOOTSTRAP_TOKEN_BYTES} bytes.`);
  }
  const application = opts.application ?? DEFAULT_ACCOUNT_APPLICATION;
  const applicationFailure = boundApplicationFailure(application);
  if (applicationFailure) throw new Error(`buildApp: ${applicationFailure}`);
  const executeImportWorker = opts.importWorker ?? runImportWorker;
  // One fail-never sink receives both legacy product mutation records and normalized account-flow
  // events. Construct it before the account boundary so the coordinator—not its HTTP caller—owns
  // audit correlation for cross-port commands.
  const auditSink = opts.audit ?? noopAuditSink();
  const logOn = opts.log === true;
  return { authMode, auth, rateLimitMax, application, executeImportWorker, auditSink, logOn };
}
