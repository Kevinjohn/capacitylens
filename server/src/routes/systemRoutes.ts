import type { FastifyInstance } from "fastify";
import type { AuditSink } from "../audit";
import { buildInternalTlsHealth } from "../internalTls";

export const CSP_REPORT_BODY_LIMIT = 64 * 1024;
const MAX_CSP_REPORTS_PER_REQUEST = 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseCspDirective = (value: unknown): string | undefined =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/i.test(value) ? value : undefined;

// CSP fields can contain full URLs, including query/fragment secrets. Security telemetry needs only
// the origin; special browser values such as "inline" are retained as a bounded classification.
const parseCspOrigin = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  if (["inline", "eval", "self", "data", "blob"].includes(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : `scheme:${url.protocol}`;
  } catch {
    return undefined;
  }
};

function parseCspReport(candidate: unknown): Record<string, unknown> | null {
  if (!isRecord(candidate)) return null;
  const legacy = isRecord(candidate["csp-report"]) ? candidate["csp-report"] : undefined;
  const modern = candidate.type === "csp-violation" && isRecord(candidate.body) ? candidate.body : undefined;
  const body = legacy ?? modern;
  if (!body) return null;
  return {
    event: "csp_violation",
    outcome: "reported",
    documentOrigin: parseCspOrigin(body["document-uri"] ?? body.documentURL),
    blockedOrigin: parseCspOrigin(body["blocked-uri"] ?? body.blockedURL),
    effectiveDirective: parseCspDirective(body["effective-directive"] ?? body.effectiveDirective),
    violatedDirective: parseCspDirective(body["violated-directive"]),
    disposition: body.disposition === "report" || body.disposition === "enforce" ? body.disposition : undefined,
  };
}

function parseCspReports(payload: unknown): Record<string, unknown>[] {
  const candidates = Array.isArray(payload) ? payload.slice(0, MAX_CSP_REPORTS_PER_REQUEST) : [payload];
  const reports: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    const report = parseCspReport(candidate);
    if (report) reports.push(report);
  }
  return reports;
}

interface MetaRouteDependencies {
  section: "meta";
  isInitialized: () => boolean;
}

interface PublicRouteDependencies {
  section: "public";
  securityEvent: (event: Record<string, unknown>) => void;
  healthStatement: { get(): unknown } | null;
  diagnosticsSchemaStatement: { get(): unknown };
  auditDrainer: { pendingCount(): number };
  auditSink: Pick<AuditSink, "degraded">;
  backupHealth?: () => Readonly<{ degraded: boolean; lastSuccessAt: string | null }>;
  internalTlsExpiresAt?: string;
  internalTlsFingerprintSha256?: string;
}

export type SystemRouteDependencies = MetaRouteDependencies | PublicRouteDependencies;

type AuditStatus = "degraded" | "recovering" | "ok";

function buildAuditStatus(auditSink: Pick<AuditSink, "degraded">, pendingCount: number): AuditStatus {
  if (auditSink.degraded) return "degraded";
  if (pendingCount > 0) return "recovering";
  return "ok";
}

function buildBackupHealth(backupHealth: Readonly<{ degraded: boolean; lastSuccessAt: string | null }>) {
  const lastSuccessAt = readBackupTimestamp(backupHealth.lastSuccessAt);
  let status: "degraded" | "ok" | "pending" = "pending";
  if (backupHealth.degraded) status = "degraded";
  else if (lastSuccessAt) status = "ok";
  return { status, lastSuccessAt };
}

function readBackupHealth(dependencies: PublicRouteDependencies) {
  if (!dependencies.backupHealth) return { status: "unavailable" as const, lastSuccessAt: null };
  try {
    return buildBackupHealth(dependencies.backupHealth());
  } catch {
    return { status: "unavailable" as const, lastSuccessAt: null };
  }
}

function readBackupTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    return null;
  return value;
}

function readDatabaseSchemaVersion(statement: { get(): unknown }): number | null {
  try {
    const row = statement.get();
    if (
      !isRecord(row) ||
      typeof row.user_version !== "number" ||
      !Number.isSafeInteger(row.user_version) ||
      row.user_version < 0
    )
      return null;
    return row.user_version;
  } catch {
    // Diagnostics surface the unavailable state; returning a raw SQLite error would disclose
    // implementation details and private paths.
    return null;
  }
}

function registerDiagnosticsRoute(app: FastifyInstance, dependencies: PublicRouteDependencies): void {
  // Authenticated through the existing application session pre-handler. Keep this response a
  // fixed projection so support tooling cannot accidentally copy tenant data or future fields.
  app.get("/api/diagnostics", (_req, reply) => {
    const schemaVersion = readDatabaseSchemaVersion(dependencies.diagnosticsSchemaStatement);
    const databaseStatus = schemaVersion === null ? "unavailable" : "ok";
    const backup = readBackupHealth(dependencies);
    if (databaseStatus === "unavailable") {
      return reply.code(503).send({
        server: {
          connectivity: "ok",
          database: { status: databaseStatus, schemaVersion: null },
          persistence: "unknown",
          backup,
        },
      });
    }
    return {
      server: {
        connectivity: "ok",
        database: { status: databaseStatus, schemaVersion },
        persistence: "unknown" as const,
        backup,
      },
    };
  });
}

function registerMetaRoute(app: FastifyInstance, dependencies: MetaRouteDependencies): void {
  // "has this dataset ever been initialised" (persistent marker), NOT "is it currently
  // non-empty" — so a user who deletes all their data isn't re-seeded on the next load
  // (the bug was: an emptied dataset reported hasData:false and got the demo seed back).
  // This authenticated probe is deliberately not membership-gated: initialization is an
  // instance-level bootstrap sentinel, not tenant data, and reveals no account, identity or row
  // count. A membership-less principal therefore receives the same single boolean needed by the
  // startup adapter without gaining access to any scoped state.
  app.get("/api/meta", () => ({ hasData: dependencies.isInitialized() }));
}

function registerPublicRoutes(app: FastifyInstance, dependencies: PublicRouteDependencies): void {
  // Public browser telemetry endpoint. It returns no data, accepts only bounded JSON media types,
  // is covered by the normal IP rate limit, and logs a strict origin/directive projection rather
  // than attacker-controlled full URLs. Authentication cannot be required because a CSP failure
  // can occur before a session exists.
  app.post("/api/security/csp-report", { bodyLimit: CSP_REPORT_BODY_LIMIT }, (req, reply) => {
    for (const report of parseCspReports(req.body)) dependencies.securityEvent(report);
    return reply.code(204).send();
  });

  // Health is deliberately constant-work AND exempt from the rate limiter (`config.rateLimit:
  // false`): an uptime monitor polls it continuously and must NEVER be told 429. Behind a proxy
  // without forwarded-IP trust every client shares one socket-IP bucket, so a limited health
  // route would let ordinary API traffic starve the monitor's probe (and vice versa). Exempting
  // it adds no amplification surface: the expensive full row-codec + foreign-key integrity
  // verification runs once during openDb(), and this handler is only a cached SELECT 1.
  app.get("/api/health", { config: { rateLimit: false } }, (_req, reply) => {
    if (!dependencies.healthStatement) return { ok: true };
    try {
      dependencies.healthStatement.get();
      const backupHealth = dependencies.backupHealth?.();
      const auditPending = dependencies.auditDrainer.pendingCount();
      // P1.15: audit-degraded is a SOFT signal — keep ok:true (the DB is fine; the audit sink
      // failing a write doesn't make the server unhealthy), just surface 'degraded' so an
      // operator can see it. The SHALLOW (non-deep) health stays exactly { ok: true } above —
      // the Playwright webServer probe contract — so the audit field appears ONLY in deep mode.
      return {
        ok: true,
        db: true,
        audit: buildAuditStatus(dependencies.auditSink, auditPending),
        auditPending,
        ...(backupHealth
          ? {
              backup: buildBackupHealth(backupHealth),
            }
          : {}),
        ...(dependencies.internalTlsExpiresAt
          ? {
              internalTls: buildInternalTlsHealth(
                dependencies.internalTlsExpiresAt,
                Date.now(),
                dependencies.internalTlsFingerprintSha256,
              ),
            }
          : {}),
      };
    } catch {
      // INTENTIONAL empty catch: the 503 IS the surfacing. A broken DB must make the uptime
      // monitor see 503 — not a lying { ok: true } 200, and not a thrown 500. Do NOT "fix" this
      // by logging-and-rethrowing; the status code is the signal the monitor needs.
      return reply.code(503).send({ ok: false });
    }
  });

  registerDiagnosticsRoute(app, dependencies);
}

// These routes are grouped as system endpoints but intentionally share no common access policy.
export function registerSystemRoutes(app: FastifyInstance, dependencies: SystemRouteDependencies): void {
  if (dependencies.section === "meta") registerMetaRoute(app, dependencies);
  else registerPublicRoutes(app, dependencies);
}
