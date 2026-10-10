---
title: TLS and networking
description: How to put a domain and TLS certificate in front of CapacityLens, and the proxy, cookie and port requirements that come with it.
---

# TLS and networking

CapacityLens sits behind a TLS-terminating reverse proxy on the same origin the browser uses.
A release-archive install needs only that proxy: see [Native install](#native-install-release-archive).
The Docker sections cover the extra nginx layer and internal TLS hop Compose adds.

## Two different nginx instances

The Docker Compose stack contains its own nginx: the `web` service, configured by the repo's
root `nginx.conf`. It serves the built app and proxies `/api/` to the API over an internal TLS
hop. It listens on `127.0.0.1:8080` and is not reachable from the internet.

The public reverse proxy is a **second, separate** one that you run on the host in front of
`127.0.0.1:8080`. It gets your domain name and the real certificate.

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

Do not edit the repository's `nginx.conf` to add public TLS. Your public proxy is a separate
config file, usually outside the repository.

## The public edge

Terminate public HTTPS at a reverse proxy or load balancer you already run: nginx, Caddy or a
platform load balancer. Never expose the API container directly.

- The Docker Compose `web` service binds port 8080 to `127.0.0.1` by default, so only a
  proxy on the same host can reach it. Set `WEB_BIND_IP` only if a private platform load
  balancer needs to reach the container host over a network you trust. Only that load
  balancer may reach the bound address, and it must connect from a private address:
  anyone else on that network could pick their own rate-limit address, and a load balancer
  with a public source address makes every person share one sign-in allowance.
- The public edge must overwrite `X-Forwarded-Proto` with the browser-visible scheme, not
  append to it. CapacityLens trusts this single hop for CSRF's same-origin check.
- The public edge must set `X-Forwarded-For` to the browser's address. The packaged nginx
  accepts it only from a loopback or private-network peer and keys per-client rate limits
  on it. Without it, every person shares one sign-in allowance. The nginx and Caddy
  examples below already do this.
- If that proxy already emits its own HSTS header, set `CAPACITYLENS_HTTPS=0`. Otherwise
  leave it unset: with an `https` `CAPACITYLENS_PUBLIC_URL`, CapacityLens adds a
  two-year host-only HSTS header itself.
- `CAPACITYLENS_PUBLIC_URL` must exactly match the browser origin the proxy serves,
  including the scheme.

### nginx example

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
for your OS. It can write the `ssl_certificate` lines and handles renewal.

### Caddy example

Caddy requests and renews a Let's Encrypt certificate itself, with no certbot step. A complete
`Caddyfile`:

```
capacity.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy fills in HTTPS, the redirect from port 80 and the forwarded headers CapacityLens needs.

Loopback API listeners (`127.0.0.1`, `localhost` or `::1`), as in the recommended bare-metal
setup, trust their same-host proxy's forwarded headers automatically.
`CAPACITYLENS_TRUST_PROXY_HEADERS=1` gives a non-loopback listener the same trust, and is safe
only when clients can't reach the API directly. Docker Compose sets it because its API listens
only on the private container network, reachable solely by the packaged nginx.

## Cookies and host requirements

With an HTTPS `CAPACITYLENS_PUBLIC_URL`, the sign-in cookie is `__Host-`-prefixed. That prefix
requires a single, secure, root-path origin, which is why the API is never exposed on its own
origin or port.

If the browser and API are deliberately on different origins, set `CAPACITYLENS_CORS_ORIGIN` to
the comma-separated browser origins. Host case, default ports and a trailing slash are
normalised; credentials, paths, queries, fragments and `*` are rejected at startup, because
sign-in uses cookies, not tokens. With a same-origin proxy, leave it unset.

## The internal hop (Docker Compose)

In the Compose stack, nginx talks to the API over TLS 1.2/1.3, with no plaintext fallback. Before
either long-running service starts, the one-shot `internal-tls` service creates a per-install
certificate authority and an API leaf certificate on a dedicated volume, and reuses a valid set on
restart. nginx verifies the `api` service name and the authority on every request. The
authority's key stays root-only, the API container reads only its own leaf key, and nginx reads
only public certificates.

Renew the leaf within 30 days of expiry:

```bash
./scripts/renew-internal-tls.sh
```

It stops and force-recreates both TLS consumers and verifies their live certificate through
nginx before reporting success. Deep `/api/health` reports the leaf expiry and fingerprint, and
`internalTls.status` changes from `ok` to `expiring` in that 30-day window: alert on it. See
[Monitoring and health checks](/self-hosting/monitoring).

## Native install (release archive)

The server serves the web app as well as the API, so one reverse-proxy line covers the whole
site. Keep the server on loopback (`CAPACITYLENS_HOST=127.0.0.1`, the default) and use
`127.0.0.1:8787`, the default port, as the upstream. Replace `capacity.example.com` in the
archive's two proxy examples with your address.

Caddy is the shorter route. Add the block from `Caddyfile.example` to `/etc/caddy/Caddyfile`:

```text
capacity.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787
}
```

Caddy obtains and renews the certificate and overwrites the forwarded headers the server trusts.
It writes no access log unless you add a `log` directive; if you do, exclude `/invite/*`,
`/reset-password/*`, `/api/invites/*`, `/api/auth/callback/*` and `/api/auth/oauth2/callback/*`:
those request lines carry single-use sign-in secrets. Reload it with:

```bash
sudo systemctl reload caddy
```

For nginx, `capacitylens.nginx.conf` is a complete site file. It terminates TLS, serves the web
app from the release's `dist/` folder, proxies `/api/`, overwrites `X-Forwarded-For` and
`X-Forwarded-Proto`, keeps invitation, sign-in and password-reset links out of the access log,
and sends the packaged `nginx.conf` security headers with a host-only HSTS header. Get the
certificate with your distribution's ACME client first, then follow the instructions at the top
of the file:

```bash
sudo cp /opt/capacitylens/current/capacitylens.nginx.conf /etc/nginx/sites-available/capacitylens
```

Replace the hostname and the certificate paths in the copy, then enable it and reload nginx:

```bash
sudo ln -s /etc/nginx/sites-available/capacitylens /etc/nginx/sites-enabled/
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

With an `https` `CAPACITYLENS_PUBLIC_URL`, the server sends HSTS itself; set
`CAPACITYLENS_HTTPS=0` if your proxy already does. Check the loopback server and the public route:

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

## Ports at a glance

| Port | What's listening                | Reachable from                                                              |
| ---- | ------------------------------- | --------------------------------------------------------------------------- |
| 8080 | nginx (web app + `/api/` proxy) | Loopback by default; your reverse proxy                                     |
| 8787 | The API (Fastify)               | Only nginx, over the internal TLS hop in Compose, or loopback on bare metal |

Next: [Monitoring and health checks](/self-hosting/monitoring) to watch certificate expiry and
proxy health.
