# Security control inventories

Version: 2026-07-14. These inventories support ASVS architecture requirements; they are not a
substitute for deployment-specific data classification, key inventory or log-retention policy.

## Entry points and untrusted input

| Input | Format and limit | Trusted enforcement | Security treatment |
|---|---|---|---|
| Tenant API route/body/query/path | JSON and bounded strings/arrays; explicit route schemas/codecs | Fastify API and shared domain | authentication, per-operation membership/action check, allowlisted tables/fields, sanitisation, relational validation |
| Whole-account import | JSON; 5 MiB and 200,000 records | Owner-only API transaction | version migration, known tables only, ids remapped, tenant forced, invalid rows repaired/dropped, references checked, all-or-nothing write |
| Password | 15–128 characters | Auth callbacks | context-word and HIBP check, exact-byte versioned scrypt hashing, generic failure paths; HIBP response is time/size bounded and redirects are refused |
| TOTP/recovery code | Better Auth bounded formats | Auth plugin | timed TOTP, lockout, encrypted recovery material, one-time use |
| Sign-up/setup/invite/reset values | Bounded JSON/path/header values | Auth/API | first-owner or invite gate, token expiry/hash/revocation, generic lookup behavior |
| Provider configuration | Environment only, not end-user input | Startup | safe provider id; absolute HTTPS endpoint; loopback-only HTTP; no embedded credentials; partial configuration fails |
| CORS/origin/forwarding headers | HTTP headers | Root API hook/proxy | exact origin allow-list, unsafe cross-site rejection, forwarded IP trusted only in packaged single-proxy shape |
| CSP violation report | bounded CSP/Reporting API JSON | Public rate-limited API route | 64 KiB, maximum 20 events, origin/directive projection only; URL paths/query/fragment discarded |
| Offline snapshot | Previously authorized API response | Browser cache layer | account/user/origin scoped, schema validation, AES-GCM integrity, seven-day expiry, read-only projection |
| Environment and numeric settings | Process environment | Startup parsers/guard | bounded integers, explicit boolean grammar, fail-closed production invariants |

There is no runtime XML, LDAP, XPath, GraphQL, WebSocket, email, Markdown/WYSIWYG, LaTeX, archive,
image, arbitrary file-upload, CSV/spreadsheet, template, shell-command, JNDI, memcache, WebRTC or media
processing entry point.

## Sensitive data and retention

| Class | Examples | Storage/transport | Retention and disclosure |
|---|---|---|---|
| Authentication secret | password verifier, MFA seed/recovery, session/reset/invite values, provider secrets | SQLite/env over TLS; restrictive host files; secret-manager responsibility | sessions fixed at 12h with 30m idle expiry; reset/invite bounded and revocable; password verifiers until identity erasure; never log values |
| Identity data | name, email, memberships, provider subject | SQLite over TLS | until identity no longer belongs to an account; account erasure removes eligible identity/control rows |
| Tenant confidential data | schedule, notes, real private names | SQLite, encrypted operator storage, role-filtered API | operator policy; owner export; account erasure; old backups/audits follow operator retention/legal hold |
| Offline tenant data | last verified identity/account/snapshot | AES-GCM IndexedDB | opt-in, maximum seven days, sign-out/device clear/schema upgrade/tamper removes records |
| Audit/security metadata | timestamp, actor/account/action/entity/field names, security outcome/IP | local JSONL and separately forwarded JSON | no entity values, credentials or bearer tokens; deployment defines access and retention |
| Device preference | theme, zoom and similar settings | localStorage | device-local, not account data/export; explicit device clear |

Every `/api/*` response receives `Cache-Control: no-store` and `Pragma: no-cache`. The SPA contains no
advertising, analytics or crash-reporting integration. The only default outbound application call is
the HIBP password range lookup during credential creation/change/reset. Enabled identity providers
add their documented browser and server exchanges.

## Cryptographic inventory

| Purpose | Primitive/library | Key/material | Lifecycle and migration |
|---|---|---|---|
| New password storage | Node `crypto.scrypt`, `N=2^17,r=8,p=1`, 16-byte salt, 64-byte result | password-derived; random salt | self-describing `scrypt-v1` record; parameters can version; legacy Better Auth scrypt verify-only |
| Password comparison | Node `timingSafeEqual` | stored/derived result | constant-time after fixed-length derivation |
| Breach lookup | SHA-1 only as required by HIBP k-anonymity protocol | ephemeral candidate digest; five-character prefix sent | never used as a verifier or security hash; response padding enabled |
| Offline snapshot | Web Crypto AES-256-GCM, 96-bit random IV and AAD | non-extractable per-browser random device key | schema v2; corrupt/expired records and v1 plaintext deleted; device clear destroys key/data |
| Invite/reset lookup | SHA-256 token digest | CSPRNG token shown once | expiry, use/revocation and account deletion remove state |
| Session/auth/MFA | Better Auth/Node crypto | `SMALLSASS_ACCOUNT_SECRET`, session tokens, encrypted backup codes/TOTP state | 32+ character operator secret; rotate to invalidate sessions; secret manager/operator rotation required |
| Internal service TLS | OpenSSL P-256/SHA-256, Node HTTPS and nginx verification | per-install root-only CA key; API-only leaf key; public CA/leaf | automatic in Compose; optional for same-host bare metal; configured identities never fall back silently; coordinated renewal/recreation |
| Public TLS/provider assertion crypto | TLS proxy, Node trust store and Better Auth providers | public certificates/provider metadata | operator certificate lifecycle; HTTPS-only provider configuration; library updates through lockfile |

No home-grown cipher, ECB, unauthenticated application encryption or client-extractable offline key
is used. The operator must maintain a deployment key/certificate inventory covering TLS, storage
encryption, secret manager, IdP credentials and backup encryption; this repository cannot observe it.

Review the inventory annually and after any cryptographic change. Rotate application/provider keys
after suspected exposure or trust-boundary/staff changes and at the deployment's documented
interval. Formats deliberately carry versions so new password/KDF and encrypted-cache profiles can
coexist during migration. The project will follow maintained Node/Web Crypto/Better Auth primitives,
track NIST and OWASP deprecations, and introduce approved post-quantum TLS/signature algorithms only
after its platform dependencies provide interoperable production implementations; no custom hybrid
cryptography will be added. Re-encryption of operator volumes/backups belongs in that platform's key
rotation plan.

`pnpm run security:crypto-inventory` automatically discovers cryptographic implementation paths
and fails when they differ from the reviewed [machine-readable inventory](crypto-inventory.json).
Both green gates run it, so a new primitive or TLS/key-handling path requires an explicit inventory
review. SBOM, dependency review and CodeQL cover third-party implementation code that this source
path check cannot inspect.

## Service connection and work limits

| Service/resource | Maximum | Limit behavior and recovery |
|---|---:|---|
| API accepted sockets | 512 per process | new sockets refused; nginx surfaces upstream failure; client retries must be bounded |
| API request/incomplete connection | 30 seconds | Fastify terminates timed-out work; proxy has bounded headroom, never an infinite read timeout |
| SQLite | one synchronous connection/process; one API process/file | waits five seconds on a held lock, then surfaces failure; restart/repair rather than spawning writers |
| Password scrypt | 2 active + 16 queued | overflow fails closed; queue releases after success or failure |
| HIBP range service | 8 active + 32 queued; 5-second call | overflow, timeout, redirect or outage fails password mutation closed |
| CSP report ingestion | 64 KiB and 20 emitted events/request | malformed/oversize rejected; excess array entries discarded; normal IP rate limit applies |
| OIDC/social provider | bounded by 512 active API requests/process | strict OIDC discovery/JWKS/user-info failures fail closed with no application retry loop; disable an unstable named social provider |
| Backup operation | one in flight | scheduler skips overlap; shutdown waits for completion before closing SQLite |

## Security and audit event inventory

| Layer | Events | Format/destination | Sensitive-data rule |
|---|---|---|---|
| API request log | method, route, status, latency and request metadata | Pino JSON stdout when enabled | no request/response bodies, cookie or authorization values |
| Security log | auth outcomes, required-auth/MFA/fresh-session rejection, authorization/CSRF denial, projected CSP reports, 429, 500, process failure and session revocation | `capacitylens.security` JSON stdout | ids/outcomes and bounded source metadata only; never credential/bearer values, exception details or CSP URL paths/queries |
| Mutation audit | actor, account, action, entity, id and changed field names | mode-0600 JSONL plus optional `capacitylens.audit` JSON stdout | field names only, never field values |
| Proxy/IdP/platform | TLS/access/WAF/container/identity/collector events | deployment-defined separate systems | operator must classify, redact, restrict, retain and correlate in UTC |

Production requires application audit to remain enabled. Forwarding security events to a separate
monitored destination is recommended but optional; its absent attestation produces a warning. The
local audit sink latches degradation into deep health. The runbook defines incident preservation and
review, but the operator must document retention, access groups, time synchronization and alerts.

## Third parties and build inputs

- Runtime: Node.js 24, Better Auth, `jose`, Fastify/server packages, React/UI packages, SQLite in
  Node, nginx and the HIBP range service; strict OIDC is first-class and named social providers are
  optional/experimental.
- Build/test: pnpm registry packages, GitHub Actions, CodeQL, Playwright browsers, Vitest, ESLint,
  Stryker, Gitleaks, Syft/Anchore, Trivy and OWASP ZAP.
- `pnpm-lock.yaml` pins the dependency graph. Docker base images are digest-pinned. GitHub actions
  are full-commit pinned. Dependabot covers npm, Actions and Docker.
- pnpm's lifecycle-script policy is fail closed; `allowBuilds` permits only esbuild's reviewed
  platform-binary linker, so a newly introduced dependency install script requires an explicit
  repository change before it can execute in a clean install.
- Workspace peers are explicit and production deployment uses a dedicated lock/graph. A
  lockfile-recorded Sonner patch disables only its runtime CSS injector; the identical published
  stylesheet is built as a self-hosted hashed asset so CSP can continue to forbid style elements.
- Runtime images remove package managers and unused network clients. The Docker build rejects
  frontend/test packages in the API graph, and all three shipped images are scanned for
  high/critical CVEs.
- CI performs dependency review, production audit, secret scan (reviewed fixture findings pinned
  in `.gitleaksignore`), CodeQL, SBOM generation, container vulnerability scanning, DAST and
  release provenance. DAST is two-tier: the blocking baseline validates the hardened posture — the
  configuration the deployment guide recommends — while the out-of-the-box default posture is
  scanned weekly as a non-blocking published report, documenting rather than asserting its
  residual surface. Workflow conditions run automatically when public and remain manually runnable
  while private.
