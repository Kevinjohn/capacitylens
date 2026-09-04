import type { FastifyInstance } from "fastify";
import type { AuditSink } from "../audit";
import { internalTlsHealth } from "../internalTls";

export const CSP_REPORT_BODY_LIMIT = 64 * 1024;
const MAX_CSP_REPORTS_PER_REQUEST = 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeCspDirective = (value: unknown): string | undefined =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/i.test(value) ? value : undefined;

// CSP fields can contain full URLs, including query/fragment secrets. Security telemetry needs only
// the origin; special browser values such as "inline" are retained as a bounded classification.
const safeCspOrigin = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  if (["inline", "eval", "self", "data", "blob"].includes(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : `scheme:${url.protocol}`;
  } catch {
    return undefined;
  }
};

function normalizedCspReports(payload: unknown): Record<string, unknown>[] {
  const candidates = Array.isArray(payload) ? payload.slice(0, MAX_CSP_REPORTS_PER_REQUEST) : [payload];
  const reports: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const legacy = isRecord(candidate["csp-report"]) ? candidate["csp-report"] : undefined;
    const modern = candidate.type === "csp-violation" && isRecord(candidate.body) ? candidate.body : undefined;
    const body = legacy ?? modern;
    if (!body) continue;
    reports.push({
      event: "csp_violation",
      outcome: "reported",
      documentOrigin: safeCspOrigin(body["document-uri"] ?? body.documentURL),
      blockedOrigin: safeCspOrigin(body["blocked-uri"] ?? body.blockedURL),
      effectiveDirective: safeCspDirective(body["effective-directive"] ?? body.effectiveDirective),
      violatedDirective: safeCspDirective(body["violated-directive"]),
      disposition: body.disposition === "report" || body.disposition === "enforce" ? body.disposition : undefined,
    });
  }
  return reports;
}

export interface SystemRouteDependencies {
  section: "public" | "meta";
  securityEvent: (event: Record<string, unknown>) => void;
  healthStatement: { get(): unknown } | null;
  auditDrainer: { pendingCount(): number };
  auditSink: Pick<AuditSink, "degraded">;
  backupHealth?: () => Readonly<{ degraded: boolean; lastSuccessAt: string | null }>;
  internalTlsExpiresAt?: string;
  internalTlsFingerprintSha256?: string;
  isInitialized: () => boolean;
}

// These routes are grouped as system endpoints but intentionally share no common access policy.
export function registerSystemRoutes(app: FastifyInstance, dependencies: SystemRouteDependencies): void {
  if (dependencies.section === "meta") {
    // "has this dataset ever been initialised" (persistent marker), NOT "is it currently
    // non-empty" — so a user who deletes all their data isn't re-seeded on the next load
    // (the bug was: an emptied dataset reported hasData:false and got the demo seed back).
    // This authenticated probe is deliberately not membership-gated: initialization is an
    // instance-level bootstrap sentinel, not tenant data, and reveals no account, identity or row
    // count. A membership-less principal therefore receives the same single boolean needed by the
    // startup adapter without gaining access to any scoped state.
    app.get("/api/meta", () => ({ hasData: dependencies.isInitialized() }));
    return;
  }

  // Public browser telemetry endpoint. It returns no data, accepts only bounded JSON media types,
  // is covered by the normal IP rate limit, and logs a strict origin/directive projection rather
  // than attacker-controlled full URLs. Authentication cannot be required because a CSP failure
  // can occur before a session exists.
  app.post("/api/security/csp-report", { bodyLimit: CSP_REPORT_BODY_LIMIT }, (req, reply) => {
    for (const report of normalizedCspReports(req.body)) dependencies.securityEvent(report);
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
        audit: dependencies.auditSink.degraded ? "degraded" : auditPending > 0 ? "recovering" : "ok",
        auditPending,
        ...(backupHealth
          ? {
              backup: {
                status: backupHealth.degraded ? "degraded" : backupHealth.lastSuccessAt ? "ok" : "pending",
                lastSuccessAt: backupHealth.lastSuccessAt,
              },
            }
          : {}),
        ...(dependencies.internalTlsExpiresAt
          ? {
              internalTls: internalTlsHealth(
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
}
