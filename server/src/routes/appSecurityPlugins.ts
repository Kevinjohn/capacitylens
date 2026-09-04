import rateLimitPlugin from "@fastify/rate-limit";
import helmetPlugin from "@fastify/helmet";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requestClientIp } from "./appErrors";
import type { AppOptions } from "../app";

export function installSecurityPlugins(app: FastifyInstance, opts: AppOptions, rateLimitMax: number) {
  // Baseline security headers (P0.5.3, @fastify/helmet): ON by default — these are pure
  // hardening with no precondition, for an API server that returns JSON only (the SPA is
  // served by Nginx, not here). Registered EARLY, before route plugins, so its onRequest
  // hook decorates every response. helmet defaults already give us nosniff
  // (X-Content-Type-Options) and X-Frame-Options: DENY (frameguard) for legacy browsers; we
  // add a strict, minimal CSP whose frame-ancestors 'none' is the modern clickjacking guard,
  // and a no-referrer Referrer-Policy. The CSP carries exactly the minimal API directives plus
  // legacy and current reporting targets — useDefaults:false below keeps
  // helmet from merging its defaults (script-src/style-src 'unsafe-inline'/img-src/etc.), since
  // nothing here loads scripts or styles. HSTS is the ONE header
  // gated OFF by default — see opts.https: it is only valid over real HTTPS, and this server
  // usually runs HTTP behind a TLS proxy, so the operator opts in via CAPACITYLENS_HTTPS=1.
  void app.register(helmetPlugin, {
    contentSecurityPolicy: {
      // useDefaults:false — we emit EXACTLY these directives, nothing merged in. This is a
      // JSON-only API (no script/style/img sources are ever needed), so helmet's defaults
      // (script-src/style-src 'unsafe-inline'/img-src/font-src/form-action/upgrade-insecure-
      // requests) would only ship surface this server never uses. Leaving useDefaults at its
      // true default silently merged all of that — including 'unsafe-inline' and upgrade-
      // insecure-requests — past the explicit set below; this pins the wire CSP to the minimal set.
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "connect-src": ["'self'"],
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
    // OFF over HTTP (the default deploy: HTTP behind a TLS-terminating proxy); only emitted
    // when the operator asserts real HTTPS fronts the origin (opts.https / CAPACITYLENS_HTTPS=1).
    hsts: opts.https === true ? { maxAge: 63072000, includeSubDomains: true } : false,
  });

  // Rate limiting (P1.5, flag CAPACITYLENS_RATE_LIMIT): registered ONLY when a positive limit
  // was configured — off means the plugin doesn't exist in the app at all. Keyed per IP;
  // behind the Nginx proxy every socket is loopback, so trustProxyHeaders swaps the
  // key to the first X-Forwarded-For hop there (and only there). 429s flow through the
  // setErrorHandler above, so the refusal is the API's usual { error } JSON shape.
  if (rateLimitMax > 0) {
    void app.register(rateLimitPlugin, {
      max: rateLimitMax,
      timeWindow: "1 minute",
      // Give the global redaction funnel positive provenance and let it return canonical text.
      // @fastify/rate-limit's default error has only a duck-typed statusCode, indistinguishable
      // from an arbitrary thrown object whose message could contain internal details.
      errorResponseBuilder: (_req, context) =>
        Object.assign(new Error("Rate limit exceeded"), {
          code: "CAPACITYLENS_RATE_LIMITED",
          statusCode: context.statusCode,
        }),
      keyGenerator: (req: FastifyRequest) => {
        return requestClientIp(req, opts.trustProxyHeaders === true);
      },
    });
  }
}
