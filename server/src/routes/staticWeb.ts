import path from "node:path";
import staticPlugin from "@fastify/static";
import type { FastifyInstance, FastifyReply } from "fastify";

// Serves the built web app (Vite's dist/) from the API process so a single server can host both.
// It mirrors the packaged nginx edge (nginx.conf + nginx-security-headers.conf):
//   - /assets/* is content-addressed, so it is cached for a year;
//   - a missing file-like path is a real 404, never the app shell;
//   - every other non-/api path is the SPA history fallback (index.html, never cached);
//   - every response, 404s included, carries the web security-header set.
// /api/* is left to the API: unknown API paths keep the API's own 404.

// Same set as nginx-security-headers.conf with $capacitylens_connect_src resolved to 'self'.
// Strict-Transport-Security is deliberately absent: it is emitted only when the operator asserts
// HTTPS (see the `https` option), so this plugin never forces it on a plain-HTTP host.
// A test parses the nginx file and asserts this set stays in step with it.
export const WEB_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; report-uri /api/security/csp-report; report-to csp-endpoint",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Reporting-Endpoints": 'csp-endpoint="/api/security/csp-report"',
};

const NO_STORE = "no-store";
const ASSETS_ROUTE = "/assets/*";
const IMMUTABLE = "public, max-age=31536000, immutable";

// Same extension list as nginx.conf's file-like location: these paths name a file, so a miss is a
// 404 rather than the SPA document (avoids web-cache deception and content-type confusion).
const FILE_LIKE_RE = /\.(?:css|js|mjs|json|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|txt|xml|webmanifest)$/i;

function isApiPath(urlPath: string): boolean {
  return urlPath.startsWith("/api/");
}

function applyWebHeaders(reply: FastifyReply, cacheControl: string): void {
  // reply.header replaces anything set earlier, so this overrides the API's helmet CSP.
  for (const [name, value] of Object.entries(WEB_SECURITY_HEADERS)) reply.header(name, value);
  reply.header("Cache-Control", cacheControl);
}

export interface StaticWebOptions {
  /** Directory holding the built web app (contains index.html). */
  webDir: string;
}

export function registerStaticWeb(app: FastifyInstance, { webDir }: StaticWebOptions): void {
  // Encapsulated so sendFile and the routes below exist only for the web app.
  void app.register(async (web) => {
    const root = path.resolve(webDir);
    // serve:false — the plugin only contributes reply.sendFile; routing is explicit below so the
    // /api fall-through, cache policy and 404 headers all match the nginx edge.
    // setHeaders runs only when a file is actually sent (200/304), which is the only time the
    // immutable policy may apply: a miss must never be cached for a year (nginx's add_header without
    // `always` and `expires` likewise skip error responses).
    await web.register(staticPlugin, {
      root,
      serve: false,
      cacheControl: false,
      index: false,
      setHeaders: (reply) => {
        if (reply.request.routeOptions.url === ASSETS_ROUTE) reply.header("Cache-Control", IMMUTABLE);
      },
    });

    // sendFile reports a path that escapes the web directory (or differs only by letter case on a
    // case-insensitive disk) as a 403 error. The edge answers those as plain misses, so do the same
    // instead of letting the API's error funnel turn them into a 500. Everything else is delegated.
    const inheritedErrorHandler = web.errorHandler;
    web.setErrorHandler((error, request, reply) => {
      if ((error as { statusCode?: unknown }).statusCode === 403) return reply.callNotFound();
      return inheritedErrorHandler.call(web, error, request, reply);
    });

    // config.rateLimit:false — page loads and assets must never consume the API's request budget.
    const config = { rateLimit: false } as const;

    web.get(ASSETS_ROUTE, { config }, async (request, reply) => {
      applyWebHeaders(reply, NO_STORE);
      const { "*": file } = request.params as { "*": string };
      return reply.sendFile(`assets/${file}`);
    });

    const serveRoute = async (request: { url: string; params: unknown }, reply: FastifyReply) => {
      const urlPath = new URL(request.url, "http://capacitylens.invalid").pathname;
      if (isApiPath(urlPath)) return reply.callNotFound();
      applyWebHeaders(reply, NO_STORE);
      if (FILE_LIKE_RE.test(urlPath)) {
        const { "*": file } = request.params as { "*": string };
        return reply.sendFile(file);
      }
      return reply.sendFile("index.html");
    };
    web.get("/", { config }, serveRoute);
    web.get("/*", { config }, serveRoute);
  });
}
