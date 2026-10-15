---
title: TLS and networking
description: Terminate TLS at a trusted public edge and keep the CapacityLens application listener private.
---

# TLS and networking

Terminate public HTTPS at the host's trusted edge proxy. The AdonisJS application listens on a
private interface and serves both the web app and API. Internal TLS generation and renewal are not
part of the current application. Do not expose the application port directly to the internet.

Set both `APP_URL` and `CAPACITYLENS_PUBLIC_URL` to the exact public HTTPS origin. The proxy must
forward the original host and overwrite the forwarded scheme and client address headers. Set
`CAPACITYLENS_TRUST_PROXY_HEADERS=1` only when the application listener accepts connections solely
from that trusted proxy. The provided native archive includes Caddy and nginx examples; review them
for your hostname, certificate paths and network before installation.

## Caddy

Use the release's `Caddyfile.example`, replacing the hostname. Caddy obtains and renews public
certificates and proxies the whole site to the loopback application listener. Caddy adds no HSTS
header, so set `CAPACITYLENS_HTTPS=1` in the environment file. If you add access
logging, exclude request paths that contain single-use invitation and password-reset secrets.

## nginx

Use the release's `capacitylens.nginx.conf` as a complete site file. Replace the hostname and
certificate paths, run `nginx -t`, then reload nginx. The file serves static assets from the
release's `backend/public` directory and proxies API and `/health/` requests to the local backend.
Keep its secret-bearing sign-in and invitation paths out of access logs. Do not add a second proxy
hop that appends untrusted `X-Forwarded-*` values.

## Listener and firewall

The release example binds to `127.0.0.1:8787`. Permit inbound public traffic only to the edge's
HTTPS port (and HTTP only when used for HTTPS redirection). Keep the application listener and the
SQLite/backup directories private to the host. If the edge runs on another machine, use a private
network and an authenticated transport provided by that infrastructure; this application does
not create an internal certificate authority or renew internal certificates.

Check `/health/live` and `/health/ready` through the intended proxy after changing networking. See
[Monitoring](/self-hosting/monitoring) for their distinct meanings.
