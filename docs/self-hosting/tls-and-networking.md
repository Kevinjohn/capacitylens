---
title: TLS and networking
description: How to put a domain and TLS certificate in front of CapacityLens, and the proxy, cookie and port requirements that come with it.
---

# TLS and networking

CapacityLens expects to sit behind a TLS-terminating reverse proxy on the same origin
the browser uses. This page covers that proxy, the internal TLS hop Docker sets up for
you, and the header and port details that make sign-in cookies work correctly.

## Two different nginx instances

It's easy to confuse these, so here's the plain-language version before anything else:
the Docker Compose stack already contains its own nginx — the `web` service, configured
by the repo's root `nginx.conf`. It serves the built app and reverse-proxies `/api/` to
the API over an internal TLS hop it sets up for you. That nginx listens on
`127.0.0.1:8080` and is not reachable from the internet.

The public reverse proxy is a **second, separate thing** — one you install and run on
the host yourself, in front of that `127.0.0.1:8080`. It's the one that gets your domain
name and a real certificate.

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

Do not edit the repository's `nginx.conf` to add public TLS — leave it alone. It already
does its job (serving the app and proxying to the API); your public proxy is a separate
config file, usually outside the repository entirely.

## The public edge

Put a reverse proxy or load balancer in front of CapacityLens and terminate public HTTPS
there — nginx, Caddy, a platform load balancer, whatever you already run. Never expose
the API container directly.

- The Docker Compose `web` service binds port 8080 to `127.0.0.1` by default, so only a
  proxy on the same host can reach it. Set `WEB_BIND_IP` only if a private platform load
  balancer needs to reach the container host over a network you trust.
- The public edge must overwrite `X-Forwarded-Proto` with the browser-visible scheme —
  not append to it. CapacityLens trusts this single hop for CSRF's same-origin check and
  for per-client rate limiting.
- If that proxy already emits its own HSTS header, leave `CAPACITYLENS_HTTPS` unset.
  Otherwise set `CAPACITYLENS_HTTPS=1` once the public response is genuinely HTTPS, and
  CapacityLens adds a two-year HSTS header itself.
- `SMALLSASS_ACCOUNT_PUBLIC_URL` must exactly match the browser origin the proxy serves,
  including the scheme.

### nginx example

A minimal, complete `server {}` block. It terminates HTTPS and reverse-proxies
everything to the `web` service on `127.0.0.1:8080`:

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

Get the certificate with [certbot](https://certbot.eff.org): it can write the
`ssl_certificate` lines above for you and handles renewal. Follow certbot's nginx
instructions for your OS rather than hand-editing paths.

### Caddy example

Caddy is the easier path if you're new to this: it requests and renews a Let's Encrypt
certificate automatically, with no separate certbot step. A complete `Caddyfile`:

```
capacity.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

That's the whole config — Caddy fills in HTTPS, the redirect from port 80, and the
forwarded headers CapacityLens needs.

Loopback API listeners (`127.0.0.1`, `localhost` or `::1`) — which is every packaged
Compose and the recommended bare-metal setup — automatically trust their same-host
proxy's forwarded headers. `CAPACITYLENS_TRUST_PROXY_HEADERS=1` opts a non-loopback
listener into the same trust, and is safe only when clients can't reach the API
directly. Docker Compose sets it because the API only listens on the private container
network, reachable solely by the packaged nginx.

## Cookies and host requirements

CapacityLens signs the browser in with a `__Host-`-prefixed cookie once
`SMALLSASS_ACCOUNT_PUBLIC_URL` is HTTPS. That cookie prefix requires the browser to see
a single, secure, root-path origin — which is exactly what the same-origin proxy
topology above provides, and why the API is never exposed on its own origin or port.

If the browser and API are intentionally on different origins — a separate origin for
the SPA, for example — set `CAPACITYLENS_CORS_ORIGIN` to the comma-separated browser
origins. Host case, default ports and a trailing slash are normalised automatically;
credentials, paths, queries, fragments and `*` are all rejected at startup, because
CapacityLens recognises a signed-in browser with cookies, not tokens. With the packaged
same-origin nginx proxy, leave `CAPACITYLENS_CORS_ORIGIN` unset — the browser never
makes a cross-origin API call.

## The internal hop (Docker Compose)

Inside the packaged Compose stack, nginx doesn't talk to the API in plaintext. Before
either long-running service starts, a one-shot `internal-tls` service creates a private,
per-install certificate authority and an API leaf certificate on a dedicated volume.
nginx verifies the `api` service name and the certificate authority over TLS 1.2/1.3 for
every request it proxies; the API listener has no plaintext fallback. The certificate
authority's own key stays root-only, the API container can read only its own leaf key,
and nginx can read only public certificates.

The initializer reuses a valid certificate set on restart rather than recreating it.
Renew the leaf within 30 days of expiry:

```bash
./scripts/renew-internal-tls.sh
```

This stops both TLS consumers, force-recreates them and verifies their live certificate
generation through nginx before reporting success. Deep `/api/health` reports the cached
leaf expiry and live certificate fingerprint, and its `internalTls.status` field changes
from `ok` to `expiring` during that same 30-day window — alert on that field. See
[Monitoring and health checks](/self-hosting/monitoring).

## Bare-metal nginx

Without Docker, run the API bound to loopback and terminate public HTTPS at nginx:

- Set `CAPACITYLENS_HOST=127.0.0.1`.
- Use `proxy_pass http://127.0.0.1:8787;` — 8787 is the API's default port.
- Route `/api/` without stripping the prefix; the server mounts every route under
  `/api/`.
- Overwrite both `X-Forwarded-For` and `X-Forwarded-Proto` the way the packaged
  `nginx.conf` does, and reuse its security headers.

For defense in depth on the internal hop, create your own internal CA-signed service
certificate, set both `CAPACITYLENS_INTERNAL_TLS_CERT` and
`CAPACITYLENS_INTERNAL_TLS_KEY`, then switch nginx to
`proxy_pass https://127.0.0.1:8787;` with `proxy_ssl_verify on`, your trusted CA and a
matching `proxy_ssl_name`. Once you configure either variable, both are required — a
partial, empty or unreadable pair refuses startup rather than silently falling back to
HTTP.

## Ports at a glance

| Port | What's listening | Reachable from |
| --- | --- | --- |
| 8080 | nginx (web app + `/api/` proxy) | Loopback by default; your reverse proxy |
| 8787 | The API (Fastify) | Only nginx, over the internal TLS hop in Compose, or loopback on bare metal |

## What's next

- [Install with Docker](/self-hosting/install-with-docker) if you're setting this up for
  the first time.
- [Monitoring and health checks](/self-hosting/monitoring) to watch certificate expiry
  and proxy health once it's running.
