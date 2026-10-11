---
title: TLS and networking
description: How to put a domain and TLS certificate in front of CapacityLens, and the proxy, cookie and port requirements that come with it.
---

# TLS and networking

CapacityLens sits behind a TLS-terminating reverse proxy on the same origin the browser uses.

## What the proxy must do

1. Terminate public HTTPS at nginx, Caddy or a platform load balancer, and proxy to the server on
   loopback: `127.0.0.1:8787` for a release-archive install, `127.0.0.1:8080` for Docker
   Compose. Never expose the API directly.
2. Overwrite `X-Forwarded-Proto` with the browser-visible scheme, not append to it.
   CapacityLens trusts this single hop for CSRF's same-origin check.
3. Set `X-Forwarded-For` to the browser's address. Per-client rate limits key on it; without it,
   every person shares one sign-in allowance. The nginx and Caddy examples on this page set both
   headers.
4. Set `CAPACITYLENS_PUBLIC_URL` to exactly the browser origin the proxy serves, including the
   scheme.
5. If the proxy already emits its own HSTS header, set `CAPACITYLENS_HTTPS=0`. Otherwise leave it
   unset: with an `https` `CAPACITYLENS_PUBLIC_URL`, CapacityLens adds a two-year host-only HSTS
   header itself.

## Linux host (release archive)

The server serves the web app as well as the API, so one reverse-proxy line covers the whole
site, as in the Caddy example. The archive's nginx file takes the other route: nginx serves the
web app's files itself and proxies only `/api/`. Either works. Keep the server on loopback
(`CAPACITYLENS_HOST=127.0.0.1`, the default) and proxy to `127.0.0.1:8787`.
[Install without Docker](/self-hosting/install-without-docker#https) sets up the archive's Caddy
or nginx example.

- Caddy obtains and renews the certificate and overwrites the forwarded headers. It writes no
  access log unless you add a `log` directive; if you do, exclude `/invite/*`,
  `/reset-password/*`, `/api/invites/*`, `/api/auth/callback/*` and
  `/api/auth/oauth2/callback/*`: those request lines carry single-use sign-in secrets.
- `capacitylens.nginx.conf` is a complete site file. It terminates TLS, serves the web app from
  the release's `dist/` folder, proxies `/api/`, overwrites both forwarded headers, keeps
  invitation, sign-in and password-reset links out of the access log, and sends the packaged
  security headers with a host-only HSTS header. Follow the instructions at the top of the file.

Check the loopback server and the public route:

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

```bash
curl -fsS https://capacity.example.com/api/health
```

Both should start with `{"ok":true,...}`. Refresh a nested app route, confirm the browser stays
on HTTPS, and check the certificate renewal job keeps the same hostname and callback origin.

To encrypt the loopback hop as well, create your own internal CA-signed service certificate, set
both `CAPACITYLENS_INTERNAL_TLS_CERT` and `CAPACITYLENS_INTERNAL_TLS_KEY`, then switch nginx to
`proxy_pass https://127.0.0.1:8787;` with `proxy_ssl_verify on`, your trusted CA and a matching
`proxy_ssl_name`. A partial, empty or unreadable pair refuses startup rather than falling back to
HTTP.

## Docker Compose

The Compose stack contains its own nginx: the `web` service, configured by the repository's root
`nginx.conf`. It serves the built app and proxies `/api/` to the API over an internal TLS hop. It
listens on `127.0.0.1:8080`. Your public proxy is a **second, separate** nginx or Caddy on the
host, with your domain name and the real certificate.

```
Browser (HTTPS, port 443)
    |
    v
Your public proxy (nginx or Caddy, run by you, on the host)
    |  connects over loopback
    v
127.0.0.1:8080 -> the `web` service (Compose's own nginx)
    |  internal TLS hop
    v
the `api` service (Fastify)
```

Do not edit the repository's `nginx.conf` to add public TLS. Your public proxy's config file
usually lives outside the repository.

Set `WEB_BIND_IP` only if a private platform load balancer needs to reach the container host over
a network you trust. Only that load balancer may reach the bound address, and it must connect
from a private address: anyone else on that network could pick their own rate-limit address, and
a load balancer with a public source address makes every person share one sign-in allowance. The
packaged nginx accepts `X-Forwarded-For` only from a loopback or private-network peer.

### nginx public proxy

A complete `server {}` block that terminates HTTPS and proxies everything to the `web` service
on `127.0.0.1:8080`:

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name capacity.example.com;

    ssl_certificate     /etc/letsencrypt/live/capacity.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/capacity.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name capacity.example.com;
    return 301 https://$host$request_uri;
}
```

Get the certificate with [certbot](https://certbot.eff.org), following its nginx instructions
for your OS; it can write the `ssl_certificate` lines and handles renewal.

### Caddy public proxy

Caddy requests and renews a Let's Encrypt certificate itself. A complete `Caddyfile`:

```
capacity.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy fills in HTTPS, the redirect from port 80 and the forwarded headers CapacityLens needs.

Loopback API listeners (`127.0.0.1`, `localhost` or `::1`), as in a release-archive install,
trust their same-host proxy's forwarded headers automatically.
`CAPACITYLENS_TRUST_PROXY_HEADERS=1` gives a non-loopback listener the same trust, and is safe
only when clients can't reach the API directly. Docker Compose sets it because its API listens
only on the private container network, reachable solely by the packaged nginx.

### The internal hop

Compose's nginx talks to the API over TLS 1.2/1.3, with no plaintext fallback. The one-shot
`internal-tls` service creates a per-install certificate authority and API leaf certificate on a
dedicated volume before the other services start, and reuses a valid set on restart. nginx
verifies the `api` service name and the authority on every request. The authority's key stays
root-only; the API reads only its own leaf key, and nginx only public certificates.

Renew the leaf within 30 days of expiry:

```bash
./scripts/renew-internal-tls.sh
```

It stops and force-recreates both TLS consumers and verifies their live certificate through nginx before
reporting success. Alert on deep health's `internalTls.status`, which changes from `ok` to
`expiring` in that 30-day window (see [Monitoring and health checks](/self-hosting/monitoring)).

## Cookies and host requirements

With an HTTPS `CAPACITYLENS_PUBLIC_URL`, the sign-in cookie is `__Host-`-prefixed, which needs a
single, secure, root-path origin. The API is never exposed on its own origin or port.

With a same-origin proxy, leave `CAPACITYLENS_CORS_ORIGIN` unset. If the browser and API are
deliberately on different origins, set it to the comma-separated browser origins. Host case,
default ports and a trailing slash are normalised; credentials, paths, queries, fragments and `*`
are rejected at startup, because sign-in uses cookies.

## Ports at a glance

| Port | What's listening                | Reachable from                                                              |
| ---- | ------------------------------- | --------------------------------------------------------------------------- |
| 8080 | nginx (web app + `/api/` proxy) | Loopback by default; your reverse proxy                                     |
| 8787 | The API (Fastify)               | Only nginx, over the internal TLS hop in Compose, or loopback on a Linux host |

Next: [Monitoring and health checks](/self-hosting/monitoring) to watch certificate expiry and
proxy health.
