# CapacityLens threat model

Version: 2026-07-14. Review this model after changes to authentication, tenancy, imports, offline
storage, deployment topology or external services.

## Security objectives

1. A user can read or change only accounts, operations, records and protected fields allowed by
   their current server-side membership and role.
2. Passwords, session tokens, reset/invite tokens, MFA seeds/recovery codes and provider secrets are
   not disclosed or stored in recoverable form where a safer representation is possible.
3. Tenant writes remain valid, atomic and attributable; corrupted relational state prevents startup.
4. Browser-delivered code cannot silently turn an authenticated browser into a cross-site write
   primitive, and sensitive API responses are not cached.
5. Operators can contain a compromised identity, restore authoritative data and investigate typed
   security/audit events without relying on the compromised host alone.

CapacityLens is not a safety-critical, payments, classified-data, real-time media or anonymous
public-upload system. Availability is important but confidentiality and tenant integrity take
priority over keeping a misconfigured production process running.

## Assets and trust boundaries

| Asset | Primary protection | Boundary |
|---|---|---|
| Account schedule and private client/project names | Server membership, action/field authorization, SQLite constraints | Browser/API and tenant boundary |
| Identity, password and MFA state | Better Auth, versioned scrypt, encrypted recovery material, fixed sessions | Auth/API and database boundary |
| Session, reset and invite bearer values | HttpOnly cookies or one-time values; hashes where supported; expiry/revocation | Browser/API and operator delivery boundary |
| Offline snapshot | Opt-in, role-filtered, AES-256-GCM, seven-day expiry, viewer-only | Browser-origin/device boundary |
| Database, WAL, audit and snapshots | `0600` files, `0700` backup directory, encrypted-volume production interlock | Process/host boundary |
| Audit and security events | Data-minimised JSON, local restrictive file plus separately forwarded stream | Process/log-collector boundary |
| Build and release inputs | Lockfile, pinned images/actions, dependency review, SBOM, scans and provenance | Contributor/CI/registry boundary |

The supported production flow is browser → public TLS proxy → unprivileged web container → verified
per-install internal TLS → unprivileged HTTPS API container → local SQLite/backup volumes. The API
container is not published and has no plaintext listener fallback. The proxy must overwrite
forwarding headers; it must not merely append to untrusted client values.

## Actors

- Viewer, editor, admin and owner, all potentially malicious within their legitimate account.
- An authenticated user attempting cross-account or higher-role access.
- An unauthenticated internet attacker, automated credential attacker or cross-site origin.
- A compromised browser profile or device.
- A malicious/compromised identity provider, dependency, build input or container base.
- A self-hosting operator who makes an accidental or unsafe configuration choice.
- A host-level attacker. Host compromise is not fully preventable in-process; encrypted storage,
  secret management, isolation and off-host logs/backups limit consequences.

## Abuse cases and controls

| Threat | Principal controls | Verification |
|---|---|---|
| BOLA/IDOR or cross-tenant mutation | Membership fetched server-side for each operation; every scoped entity has `accountId`; row/reference validation fails closed when a project-bound allocation cannot resolve its project in the same account; cross-account tests | `app.authz`, `app.members`, tenant-store, route and shared mutation tests |
| Function/field privilege escalation | Central action matrix; protected-name projection/preservation; owner-only import; fresh session for privileged actions | access, privacy and route tests |
| Credential stuffing/password cracking | Positive global/API throttling; five-attempt MFA lock; 15–128 characters; HIBP range check; scrypt `N=2^17,r=8,p=1`; no default password | password/auth/rate-limit tests |
| Password-only account takeover | Mandatory production TOTP wall before tenant data; one-time recovery codes; no trusted-device request in UI | real auth integration and UI tests |
| Session theft/fixation | Secure HttpOnly SameSite `__Host-` cookies; new token on auth; fixed 12-hour and 30-minute idle limits; revocation/reset invalidation; session inventory | auth and member revocation tests |
| CSRF and cross-origin data use | Unsafe-method Origin/Sec-Fetch-Site rejection; exact configured or trusted-proxy-derived same origin; SameSite cookie; safe HTTP methods | CSRF/CORS and packaged-proxy tests |
| Injection/XSS/mass assignment | React text rendering; no untrusted HTML; parameterized SQLite; explicit table/column codecs; sanitisation and structural limits; CSP | server/shared/CSP tests |
| Malicious or oversized import | JSON-only, 5 MiB/200,000-record caps; schema migration/sanitisation; account remap; reference validation; atomic owner-only transaction | import and mutation tests |
| Offline cache disclosure/tampering | Role-filtered input; non-extractable device key; AES-GCM with random IV/AAD; tamper/expiry deletion; viewer-only | offline cache tests |
| Database corruption/partial write | Startup foreign-key check; WAL; transactions; optimistic concurrency; atomic imports/backups | migration, transaction and restore-drill tests |
| Log erasure/injection or invisible attack | Structured serialization, no values/credentials, restrictive modes, health degradation latch, separate JSON stream and production forwarding interlock | audit/log/production-guard tests |
| SSRF/provider substitution | Operator-only exact provider configuration; HTTPS endpoints; loopback-only HTTP exception; no embedded credentials; library issuer/signature checks | auth configuration tests; provider still experimental |
| Resource exhaustion | 512 accepted-socket ceiling; per-IP rate limit including health; 2-active/16-queued scrypt and 8-active/32-queued HIBP work; import/CSP caps; request timeouts; constant health | resource-queue/rate-limit/health/import/CSP tests |
| Supply-chain compromise | Exact lockfile, pinned action/base-image commits/digests, Dependabot, CodeQL, Gitleaks, dependency review, SBOM, Trivy, ZAP and tagged provenance | local gates and public/manual workflows |

## Residual and accepted risks

- Generic OIDC/social authentication remains experimental. The auth library is relied upon for
  protocol-level state, nonce, issuer, signature and audience processing; each configured provider
  needs staging interoperability and logout/session-lifetime testing.
- TOTP is MFA but not phishing-resistant. WebAuthn/FIDO2 is required before claiming ASVS L3
  phishing-resistant authentication.
- Existing legacy Better Auth scrypt hashes use the former weaker profile until the user changes or
  resets the password. They are verify-only; new material never uses that format.
- The application has no IP/device-risk engine, anomalous-login user notification, global
  administrator “revoke everyone” control or HSM/full-memory encryption.
- Public TLS, encrypted host volumes, secret-manager/HSM use, clock synchronization, log retention
  and off-host collection are deployment controls. Internal service TLS is application-packaged;
  startup acknowledgements cannot inspect the quality of the remaining external controls.
- An unlocked or compromised application origin can invoke its non-extractable offline key. Device
  encryption, patching and profile access control remain necessary.
- A single-process SQLite service can still be denied service by sufficient network or tenant-valid
  load. Edge rate limiting, connection limits and resource monitoring remain operator controls.
