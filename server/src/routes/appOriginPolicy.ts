import type { FastifyRequest } from "fastify";

// Resolve the Access-Control-Allow-Origin value for a request. '*' echoes the
// wildcard; an allow-list reflects the request's Origin only when it's on the list
// (and otherwise sends no ACAO header, so the browser blocks the cross-origin call).
// Requests with no Origin (curl, server-to-server, Playwright's APIRequestContext)
// are unaffected — CORS only governs browser cross-origin reads.
export function resolveCorsOrigin(reqOrigin: string | undefined, allow: ReadonlySet<string>): string | null {
  return reqOrigin && allow.has(reqOrigin) ? reqOrigin : null;
}

export function requestOriginIsSameOrigin(req: FastifyRequest, reqOrigin: string, trustForwarded: boolean): boolean {
  const host = req.headers.host;
  if (!host) return false;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const candidate = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = trustForwarded && (candidate === "http" || candidate === "https") ? candidate : req.protocol;
  let origin: URL;
  let reconstructed: URL;
  // Total function: BOTH the browser-set Origin AND the reconstructed `${protocol}://${host}` are
  // untrusted, attacker-/proxy-influenced strings. A broken reverse proxy (or a hand-forged request)
  // can present a Host that `new URL` rejects — 'exa mple.com', '[', 'host:port:port' — so the
  // reconstruct MUST stay inside the guard alongside the Origin parse. A prior refactor moved it out,
  // which turned an unparseable Host into an uncaught TypeError → unhandled 500. Either parse failing
  // means "cannot prove same-origin", which fails CLOSED: return false so the CSRF gate answers a
  // clean 403, never a 500.
  try {
    origin = new URL(reqOrigin);
    reconstructed = new URL(`${protocol}://${host}`);
  } catch {
    return false;
  }
  if (origin.origin === reconstructed.origin) return true;
  // TLS-termination fallback (no Fetch Metadata, forwarded-proto not trusted). The standard
  // reverse-proxy pattern terminates HTTPS at the edge and forwards CLEARTEXT to this process, so
  // the browser-set Origin claims `https://<host>` while req.protocol only ever sees `http`. When
  // the Origin's host:port matches our Host header and the ONLY difference is that scheme upgrade,
  // treat it as same-origin. This is safe because the BROWSER — not the caller — populates the
  // Origin host: an attacker on another site cannot forge `https://<our-host>` as their Origin.
  // The residual accepted risk is narrow: a misconfigured deployment that genuinely serves plain
  // HTTP on the same host:port it advertises as HTTPS would be treated as same-origin — an operator
  // error, not an attacker-reachable one. We deliberately do NOT accept the reverse (Origin http
  // while we are https) and never accept any host:port mismatch.
  return origin.protocol === "https:" && reconstructed.protocol === "http:" && origin.host === reconstructed.host;
}
