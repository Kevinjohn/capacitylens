import { assertUnambiguousJson } from "@capacitylens/shared/data/strictJson";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authTransactionGateFor } from "../authTransactionGate";
import type { GateSlot } from "../authTransactionGate";
import { AccountContractError, statusForAccountFailure } from "@capacitylens/shared/account/errors";
import { CSP_REPORT_BODY_LIMIT } from "./systemRoutes";
import { runWithRequestAbortSignal } from "../requestAbort";
import type { Db } from "../db";
import { MAX_SERVER_CONNECTIONS, resolveSafeClientError } from "./appLimits";
import { redactSecretUrl } from "./appLogging";
import { resolveRequestClientIp, fail } from "./appErrors";
import type { resolveAppConfig } from "./appConfig";
import type { createAppRuntime } from "./appRuntime";
import { DEFAULT_CORS } from "./appConfig";
import type { AppOptions } from "../app";
import { installSecurityPlugins } from "./appSecurityPlugins";
import { AUTH_CLIENT_IP_HEADER } from "../authConfig/sessionPolicy";
import { REPLY_ERRORS } from "./replyErrors";

interface InstallRootHooksInput {
  app: FastifyInstance;
  db: Db;
  runtime: ReturnType<typeof createAppRuntime>;
  config: ReturnType<typeof resolveAppConfig>;
  options: AppOptions;
}

function resolveCorsOrigins(corsOrigin: string): Set<string> {
  return new Set(
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
}

interface InstallResponseHooksInput {
  app: FastifyInstance;
  db: Db;
  auditDrainer: ReturnType<typeof createAppRuntime>["auditDrainer"];
  repliesWithAuditDrain: ReturnType<typeof createAppRuntime>["repliesWithAuditDrain"];
  securityEvent: (event: Record<string, unknown>) => void;
  trustProxyHeaders: boolean;
}

function isApiRequest(req: FastifyRequest): boolean {
  return (req.url.split("?", 1)[0] ?? req.url).startsWith("/api/");
}

function installResponseHooks(input: InstallResponseHooksInput): void {
  const { app, db, auditDrainer, repliesWithAuditDrain, securityEvent, trustProxyHeaders } = input;
  app.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply, payload) => {
    if (isApiRequest(req)) {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
      reply.header("Reporting-Endpoints", 'csp-endpoint="/api/security/csp-report"');
      if (db.isOpen && !repliesWithAuditDrain.has(reply) && !auditDrainer.drainOnce()) {
        reply.header("x-capacitylens-audit-warning", "true");
      }
    }
    return payload;
  });
  app.addHook("onResponse", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?", 1)[0] ?? req.url;
    const authOperation =
      req.method !== "OPTIONS" && /^\/api\/auth\/(sign-in|sign-out|callback|change-password|reset-password)/.test(path);
    if (authOperation || reply.statusCode === 429) {
      let outcome = "blocked";
      if (authOperation) outcome = reply.statusCode < 400 ? "success" : "failure";
      securityEvent({
        event: authOperation ? "authentication" : "rate_limit",
        outcome,
        method: req.method,
        path,
        status: reply.statusCode,
        remoteIp: resolveRequestClientIp({ request: req, trustProxyHeaders }),
        ...(authOperation && req.authenticationUserId !== null ? { userId: req.authenticationUserId } : {}),
      });
    }
  });
}

function installBoundedJsonParser(app: FastifyInstance): void {
  const defaultParser = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    try {
      const source = new TextDecoder("utf-8", { fatal: true }).decode(body as Buffer);
      if (!req.url.startsWith("/api/auth/")) assertUnambiguousJson(source);
      void defaultParser(req, source, done);
    } catch (cause) {
      const error = new Error(cause instanceof Error ? cause.message : "Invalid JSON input.") as Error & {
        code: string;
        statusCode: number;
      };
      error.code = "CAPACITYLENS_INVALID_JSON_BOUNDARY";
      error.statusCode = 400;
      done(error, undefined);
    }
  });
}

function installBodyParsers(app: FastifyInstance): void {
  installBoundedJsonParser(app);
  installCspReportParser(app);
}

function installCspReportParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    ["application/csp-report", "application/reports+json"],
    { parseAs: "buffer", bodyLimit: CSP_REPORT_BODY_LIMIT },
    (req, body, done) => {
      if (req.url.split("?", 1)[0] !== "/api/security/csp-report") {
        const error = new Error(REPLY_ERRORS.unsupportedMediaType) as Error & { code: string; statusCode: number };
        error.code = "FST_ERR_CTP_INVALID_MEDIA_TYPE";
        error.statusCode = 415;
        done(error, undefined);
        return;
      }
      try {
        const source = new TextDecoder("utf-8", { fatal: true }).decode(body as Buffer);
        assertUnambiguousJson(source);
        done(null, JSON.parse(source));
      } catch {
        const error = new Error(REPLY_ERRORS.malformedCspReport) as Error & { code: string; statusCode: number };
        error.code = "CAPACITYLENS_MALFORMED_CSP_REPORT";
        error.statusCode = 400;
        done(error, undefined);
      }
    },
  );
}

type CreateSecurityEventOptions = { app: FastifyInstance; options: AppOptions; logOn: boolean };
function createSecurityEvent({ app, options, logOn }: CreateSecurityEventOptions) {
  return (event: Record<string, unknown>): void => {
    try {
      const safeEvent = typeof event.path === "string" ? { ...event, path: redactSecretUrl(event.path) } : event;
      options.securityLog?.(safeEvent);
    } catch (error) {
      if (logOn) app.log.error(error, "security event logging failed");
      else console.error("capacitylens-server: security event logging failed");
    }
  };
}

function installConnectionHooks(
  app: FastifyInstance,
  options: AppOptions,
  securityEvent: (event: Record<string, unknown>) => void,
): void {
  // Every conversion of these headers for Better Auth carries the server's own client address.
  app.addHook("onRequest", function stampAuthClientIp(req, _reply, done) {
    req.headers[AUTH_CLIENT_IP_HEADER] = resolveRequestClientIp({
      request: req,
      trustProxyHeaders: options.trustProxyHeaders === true,
    });
    done();
  });
  app.addHook("onRequest", function abortOnClientDisconnect(req, reply, done) {
    const controller = new AbortController();
    req.raw.once("aborted", () => controller.abort(new Error("The request was aborted.")));
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) controller.abort(new Error("The client disconnected."));
    });
    runWithRequestAbortSignal(controller.signal, done, (queue, reason) =>
      securityEvent({
        event: "password_security_queue_saturated",
        outcome: "blocked",
        queue,
        reason,
        method: req.method,
        path: req.url.split("?", 1)[0],
        remoteIp: resolveRequestClientIp({ request: req, trustProxyHeaders: options.trustProxyHeaders === true }),
      }),
    );
  });
  app.server.maxConnections = MAX_SERVER_CONNECTIONS;
  let lastConnectionLimitEventAt = Number.NEGATIVE_INFINITY;
  app.server.on("drop", () => {
    const now = Date.now();
    if (now - lastConnectionLimitEventAt < 60_000) return;
    lastConnectionLimitEventAt = now;
    securityEvent({ event: "connection_limit", outcome: "blocked", limit: MAX_SERVER_CONNECTIONS });
  });
}

/** Hold the authentication transaction gate for each API request, from arrival until the response
 * closes, so the request's writes never meet a library transaction left open across an await.
 * Fastify binds body parsing to the request's async context, so the slot stays visible to a library
 * transaction the handler starts. The slot spans the whole request, so a long-lived streaming route
 * would stall every sign-in. */
function installAuthTransactionGate(app: FastifyInstance, db: Db): void {
  const gate = authTransactionGateFor(db);
  app.addHook("onRequest", function holdAuthTransactionGate(req, reply, done) {
    if (!isApiRequest(req)) {
      done();
      return;
    }
    const slot: GateSlot = { held: false, closed: false };
    reply.raw.once("close", () => gate.release(slot));
    void gate.enter(slot).then(() => gate.runInSlot(slot, done));
  });
}

export function installRootHooks({ app, db, runtime, config, options }: InstallRootHooksInput) {
  const { auditDrainer, repliesWithAuditDrain } = runtime;
  const { logOn, rateLimitMax } = config;
  app.addHook("onClose", () => auditDrainer.stop());
  const securityEvent = createSecurityEvent({ app: app, options: options, logOn: logOn });
  installConnectionHooks(app, options, securityEvent);
  installAuthTransactionGate(app, db);
  // Fail-closed: an omitted corsOrigin locks to the localhost allow-list, not a wildcard.
  const corsOrigin = options.corsOrigin ?? DEFAULT_CORS;
  const corsOrigins = resolveCorsOrigins(corsOrigin);
  // 500s with logging on go through the request-scoped logger (one parseable JSON line,
  // correlated with the request); off keeps today's bare console.error.
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
  // Single redaction funnel for any uncaught throw (a route that forgot a try/catch, a
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
      return reply.code(errorStatus).send({ error: REPLY_ERRORS.internalServerError });
    }
    const safe = resolveSafeClientError(error);
    if (safe) {
      return reply.code(safe.status).send({ error: safe.message });
    }
    return sendFail(reply, error);
  });

  // Browsers use non-JSON media types for CSP reports. Parse them as bounded JSON so malformed or
  // oversized telemetry is rejected before the handler and can never become a logging DoS path.
  installBodyParsers(app);

  installSecurityPlugins(app, options, rateLimitMax);

  installResponseHooks({
    app,
    db,
    auditDrainer,
    repliesWithAuditDrain,
    securityEvent,
    trustProxyHeaders: options.trustProxyHeaders === true,
  });

  return { sendFail, accountFail, securityEvent, corsOrigins };
}
