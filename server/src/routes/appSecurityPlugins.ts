import rateLimitPlugin from "@fastify/rate-limit";
import helmetPlugin from "@fastify/helmet";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { resolveRequestClientIp } from "./appErrors";
import type { AppOptions } from "../app";
import { REPLY_ERRORS } from "./replyErrors";

/** Installs the security headers and request limits used by the API. */
export function installSecurityPlugins(app: FastifyInstance, options: AppOptions, rateLimitMax: number) {
  // Register API security headers before route plugins so every response inherits them.
  // Static web routes supply their own web CSP; HSTS depends on the browser-facing HTTPS origin.
  void app.register(helmetPlugin, {
    contentSecurityPolicy: {
      // Keep the API CSP explicit: web routes apply their separate script, style and image policy.
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "connect-src": ["'self'"],
        "img-src": ["'self'", "data:", "https:"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
        "report-uri": ["/api/security/csp-report"],
        "report-to": ["csp-endpoint"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    // X-Frame-Options: DENY for legacy browsers (helmet's default is SAMEORIGIN); the modern
    // equivalent is the CSP frame-ancestors 'none' above. This API is never framed, so DENY.
    frameguard: { action: "deny" },
    // Off over HTTP; only emitted when real HTTPS fronts the origin (opts.https, derived from
    // CAPACITYLENS_HTTPS or the https public URL). Host-only: sibling subdomains are not ours to pin.
    hsts: options.https === true ? { maxAge: 63072000, includeSubDomains: false } : false,
  });

  // Enable the limiter only for a positive configured rate.
  // Trusted proxy mode selects the forwarded client IP; canonical 429 errors use the global redaction funnel.
  if (rateLimitMax > 0) {
    void app.register(rateLimitPlugin, {
      max: rateLimitMax,
      timeWindow: "1 minute",
      // Give the global redaction funnel positive provenance and let it return canonical text.
      // @fastify/rate-limit's default error has only a duck-typed statusCode, indistinguishable
      // from an arbitrary thrown object whose message could contain internal details.
      errorResponseBuilder: (_req, context) =>
        Object.assign(new Error(REPLY_ERRORS.rateLimited), {
          code: "CAPACITYLENS_RATE_LIMITED",
          statusCode: context.statusCode,
        }),
      keyGenerator: (req: FastifyRequest) => {
        return resolveRequestClientIp({ request: req, trustProxyHeaders: options.trustProxyHeaders === true });
      },
    });
  }
}
