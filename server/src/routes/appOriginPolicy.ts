import type { FastifyRequest } from "fastify";

/** Returns the allowed origin to echo, or null when the request origin is not allowed. */
export function resolveCorsOrigin(reqOrigin: string | undefined, allow: ReadonlySet<string>): string | null {
  return reqOrigin && allow.has(reqOrigin) ? reqOrigin : null;
}

interface IsSameRequestOriginInput {
  req: FastifyRequest;
  reqOrigin: string;
  trustForwarded: boolean;
}

/** Returns whether the origin matches the request host under the configured proxy policy. */
export function isSameRequestOrigin({ req, reqOrigin, trustForwarded }: IsSameRequestOriginInput): boolean {
  const host = req.headers.host;
  if (!host) return false;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const candidate = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = trustForwarded && (candidate === "http" || candidate === "https") ? candidate : req.protocol;
  let origin: URL;
  let reconstructed: URL;
  // Total function: both the browser-set Origin and the reconstructed `${protocol}://${host}` are
  // untrusted, attacker-/proxy-influenced strings. A broken reverse proxy (or a hand-forged request)
  // can present a Host that `new URL` rejects ('exa mple.com', '[', 'host:port:port') so the
  // reconstructed URL stays inside the guard alongside the Origin parse. Either parse failing
  // means "cannot prove same-origin", which fails closed: return false so the CSRF gate answers a
  // clean 403, never a 500.
  try {
    origin = new URL(reqOrigin);
    reconstructed = new URL(`${protocol}://${host}`);
  } catch {
    return false;
  }
  if (origin.origin === reconstructed.origin) return true;
  // TLS-termination fallback (no Fetch Metadata, forwarded-proto not trusted). The standard
  // reverse-proxy pattern terminates HTTPS at the edge and forwards cleartext to this process, so
  // the browser-set Origin claims `https://<host>` while req.protocol only ever sees `http`. When
  // the Origin's host:port matches our Host header and the only difference is that scheme upgrade,
  // treat it as same-origin. This is safe because the browser, not the caller, populates the
  // Origin host: an attacker on another site cannot forge `https://<our-host>` as their Origin.
  // The residual accepted risk is narrow: a misconfigured deployment that genuinely serves plain
  // HTTP on the same host:port it advertises as HTTPS would be treated as same-origin, an operator
  // error, not an attacker-reachable one. We deliberately do not accept the reverse (Origin http
  // while we are https) and never accept any host:port mismatch.
  return origin.protocol === "https:" && reconstructed.protocol === "http:" && origin.host === reconstructed.host;
}
