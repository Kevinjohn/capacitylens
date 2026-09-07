import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AccountContractError, statusForAccountFailure } from "@capacitylens/shared/account/errors";
import { CSP_REPORT_BODY_LIMIT } from "./systemRoutes";
import { runWithRequestAbortSignal } from "../requestAbort";
import { type Db } from "../db";
import { MAX_SERVER_CONNECTIONS, resolveSafeClientError } from "./appLimits";
import { redactSecretUrl } from "./appLogging";
import { resolveRequestClientIp, fail } from "./appErrors";
import type { resolveAppConfig } from "./appConfig";
import type { createAppRuntime } from "./appRuntime";
import { DEFAULT_CORS } from "./appConfig";
import type { AppOptions } from "../app";
import { installSecurityPlugins } from "./appSecurityPlugins";

export function installRootHooks(
  app: FastifyInstance,
  db: Db,
  runtime: ReturnType<typeof createAppRuntime>,
  config: ReturnType<typeof resolveAppConfig>,
  options: AppOptions,
) {
  const { auditDrainer, repliesWithAuditDrain } = runtime;
  const { logOn, rateLimitMax } = config;
  app.addHook("onClose", () => auditDrainer.stop());
  app.addHook("onRequest", function abortOnClientDisconnect(request, reply, done) {
    const controller = new AbortController();
    request.raw.once("aborted", () => controller.abort(new Error("The request was aborted.")));
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) controller.abort(new Error("The client disconnected."));
    });
    runWithRequestAbortSignal(controller.signal, done, (queue, reason) => {
      securityEvent({
        event: "password_security_queue_saturated",
        outcome: "blocked",
        queue,
        reason,
        method: request.method,
        path: request.url.split("?", 1)[0],
        remoteIp: resolveRequestClientIp(request, options.trustProxyHeaders === true),
      });
    });
  });
  // A finite process-wide socket ceiling gives the reverse proxy a deterministic overload signal
  // instead of allowing unbounded accepted connections to consume memory/file descriptors.
  app.server.maxConnections = MAX_SERVER_CONNECTIONS;
  // Fail-closed: an omitted corsOrigin locks to the localhost allow-list, NOT a wildcard.
  const corsOrigin = options.corsOrigin ?? DEFAULT_CORS;
  const corsOrigins = new Set(
    corsOrigin
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((configuredOrigin) => {
        if (configuredOrigin === "*") {
          throw new Error("CORS requires explicit origins when cookie authentication is enabled.");
        }
        let parsed: URL;
        try {
          parsed = new URL(configuredOrigin);
        } catch (cause) {
          throw new Error(`Invalid CORS origin ${JSON.stringify(configuredOrigin)}: expected a bare HTTP(S) origin.`, {
            cause,
          });
        }
        if (
          (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
          parsed.username !== "" ||
          parsed.password !== "" ||
          parsed.pathname !== "/" ||
          parsed.search !== "" ||
          parsed.hash !== ""
        ) {
          throw new Error(
            `Invalid CORS origin ${JSON.stringify(configuredOrigin)}: expected a bare HTTP(S) origin without credentials, a path, query, or fragment.`,
          );
        }
        return parsed.origin;
      }),
  );
  // 500s with logging ON go through the request-scoped logger (one parseable JSON line,
  // correlated with the request); OFF keeps today's bare console.error.
  const sendFail = (reply: FastifyReply, error: unknown) =>
    fail(reply, error, logOn ? (e: unknown) => reply.log.error(e) : undefined);
  const accountFail = (reply: FastifyReply, error: unknown) => {
    if (!(error instanceof AccountContractError)) return sendFail(reply, error);
    const retryAfterSeconds =
      typeof error.failure.retryAfterSeconds === "number" &&
      Number.isFinite(error.failure.retryAfterSeconds) &&
      error.failure.retryAfterSeconds >= 0
        ? error.failure.retryAfterSeconds
        : undefined;
    if (retryAfterSeconds !== undefined) reply.header("retry-after", String(Math.ceil(retryAfterSeconds)));
    return reply.code(statusForAccountFailure(error.failure)).send({
      error: error.failure.message,
      code: error.failure.code,
      retryable: error.failure.retryable,
      ...(error.failure.commandId ? { commandId: error.failure.commandId } : {}),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  };
  const securityEvent = (event: Record<string, unknown>): void => {
    try {
      // Central path-secret boundary: every security event passes here, including early auth/MFA/
      // rate-limit refusals. A caller cannot accidentally bypass invite-token redaction by logging
      // the raw request path instead of remembering to sanitize it at each event site.
      const safeEvent = typeof event.path === "string" ? { ...event, path: redactSecretUrl(event.path) } : event;
      options.securityLog?.(safeEvent);
    } catch (error) {
      // A monitoring transport must never turn a safe refusal into an application outage.
      if (logOn) app.log.error(error, "security event logging failed");
      else console.error("capacitylens-server: security event logging failed");
    }
  };

  // Node emits `drop` when maxConnections refuses a newly accepted socket. Keep the signal
  // privacy-safe and rate-limited: an overload must be visible without turning a connection storm
  // into a logging storm.
  let lastConnectionLimitEventAt = Number.NEGATIVE_INFINITY;
  app.server.on("drop", () => {
    const now = Date.now();
    if (now - lastConnectionLimitEventAt < 60_000) return;
    lastConnectionLimitEventAt = now;
    securityEvent({
      event: "connection_limit",
      outcome: "blocked",
      limit: MAX_SERVER_CONNECTIONS,
    });
  });

  // Single redaction funnel for any UNCAUGHT throw (a route that forgot a try/catch, a
  // SQLITE_BUSY thrown mid-statement). Positively identified parsing errors carry safe messages.
  // A duck-typed statusCode alone proves nothing about message safety; unknown errors route through
  // fail() so a 500 stays generic and a 400 DB-constraint message cannot leak schema internals.
  app.setErrorHandler((error, req, reply) => {
    const errorStatus = (error as { statusCode?: unknown }).statusCode;
    if (typeof errorStatus === "number" && Number.isInteger(errorStatus) && errorStatus >= 500 && errorStatus <= 599) {
      securityEvent({
        event: "unexpected_error",
        outcome: "failure",
        method: req.method,
        path: req.url,
        status: errorStatus,
      });
      if (logOn) req.log.error(error);
      else console.error(error);
      return reply.code(errorStatus).send({ error: "Internal server error" });
    }
    const safe = resolveSafeClientError(error);
    if (safe) {
      return reply.code(safe.status).send({ error: safe.message });
    }
    return sendFail(reply, error);
  });

  // Browsers use non-JSON media types for CSP reports. Parse them as bounded JSON so malformed or
  // oversized telemetry is rejected before the handler and can never become a logging DoS path.
  app.addContentTypeParser(
    ["application/csp-report", "application/reports+json"],
    { parseAs: "string", bodyLimit: CSP_REPORT_BODY_LIMIT },
    (_req, body, done) => {
      try {
        done(null, JSON.parse(typeof body === "string" ? body : body.toString("utf8")));
      } catch {
        const error = new Error("Malformed CSP report") as Error & {
          code: string;
          statusCode: number;
        };
        error.code = "CAPACITYLENS_MALFORMED_CSP_REPORT";
        error.statusCode = 400;
        done(error, undefined);
      }
    },
  );

  installSecurityPlugins(app, options, rateLimitMax);

  // ASVS v5.0.0 V14.3.2: authenticated/API data must never be retained by a browser,
  // intermediary, or shared cache. Apply this at the root so Better Auth responses, errors,
  // health, and every custom route share one invariant. `no-store` is the normative control;
  // the legacy Pragma header protects older HTTP/1.0 intermediaries.
  app.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply, payload) => {
    if (req.url.split("?", 1)[0].startsWith("/api/")) {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
      reply.header("Reporting-Endpoints", 'csp-endpoint="/api/security/csp-report"');
      // Account flows enqueue while their coordinator transaction may still be open. Deliver only
      // after the handler has completed, preserving committed rows whenever the sink is degraded.
      if (db.isOpen && !repliesWithAuditDrain.has(reply) && !auditDrainer.drainOnce()) {
        reply.header("x-capacitylens-audit-warning", "true");
      }
    }
    return payload;
  });

  app.addHook("onResponse", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?", 1)[0];
    const authOperation =
      req.method !== "OPTIONS" &&
      /^\/api\/auth\/(sign-in|sign-out|callback|oauth2\/callback|two-factor|change-password|reset-password)/.test(path);
    if (authOperation) {
      securityEvent({
        event: "authentication",
        outcome: reply.statusCode < 400 ? "success" : "failure",
        method: req.method,
        path,
        status: reply.statusCode,
        remoteIp: resolveRequestClientIp(req, options.trustProxyHeaders === true),
        ...(req.authenticationUserId === null ? {} : { userId: req.authenticationUserId }),
      });
    } else if (reply.statusCode === 429) {
      securityEvent({
        event: "rate_limit",
        outcome: "blocked",
        method: req.method,
        path,
        status: 429,
        remoteIp: resolveRequestClientIp(req, options.trustProxyHeaders === true),
      });
    }
  });

  return { sendFail, accountFail, securityEvent, corsOrigins };
}
