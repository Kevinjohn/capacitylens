# Development

The day-to-day detail behind the README's quickstart: what the dev scripts actually boot,
the full test matrix, and the troubleshooting knowledge that used to live in the README.
Contributor norms (PR size, style, review) are in [`CONTRIBUTING.md`](../CONTRIBUTING.md);
the error-handling standard is [`DEFENSIVE-CODING.md`](../DEFENSIVE-CODING.md).

## Dev servers

```bash
pnpm run dev        # FULL-STACK: SQLite API (:8787) + Vite (:5173) via a dev /api proxy
pnpm run dev:demo   # Vite-only localStorage DEMO build (VITE_CAPACITYLENS_DEMO=1)
pnpm run dev:web    # Vite-only SERVER mode — talks to an API you run yourself
```

`pnpm run dev` **needs Node 24** (the API uses Node's built-in `node:sqlite`; both the
launcher and the server preflight the version and refuse with a pointer at `.nvmrc`). It
boots the API on **:8787** alongside Vite on **:5173** and wires a Vite dev proxy so the
app talks to a same-origin `/api`, exactly like production behind nginx. The server seeds
a fresh SQLite DB on first boot (demo agency "Studio North"); the `dev:demo` build seeds
`localStorage` instead.

By default the app builds in **server mode** — even with no `VITE_CAPACITYLENS_API` set,
the client calls a relative `/api`. `VITE_CAPACITYLENS_API=<origin>` only overrides the
backend origin (e.g. a remote API); it is not an on-switch. `VITE_CAPACITYLENS_DEMO=1` is
the only route to the backend-less localStorage build. Both modes talk through the same
persistence seam, so nothing else about the app changes.

### Port discipline

The dev server binds IPv4 loopback with a **strict port**: if 5173 is already taken (a
stale server, or a sibling repo claiming the same port), Vite exits with an error instead
of silently starting on 5174 — kill the squatter (`lsof -nP -iTCP:5173 -sTCP:LISTEN`)
rather than browsing a port nothing answers; that mismatch looks like a blank white page
with an empty console. The full-stack launcher likewise refuses to start if **:8787** is
already held, and tears the whole stack down if either half dies (no half-up stack).

### "Loading… / JavaScript isn't running"

The browser is blocking scripts for the site (per-site JavaScript setting or a
content-blocker extension — both also apply in private windows when allowed there).
Enable JavaScript for the site and reload; the whole app is JS-rendered.

## The green gate

```bash
pnpm run gate         # paraglide:compile && tsc -b && eslint . && vitest run && vite build
pnpm run gate:server  # type-check + test + lint (eslint server shared) the server/ workspace
pnpm run e2e          # Chromium: core + db-backed + auth-backed specs; boots 3 Vite + 2 API servers, needs Node 24
pnpm run e2e:webkit   # the core specs on Safari/WebKit (opt-in; Vite-only, no Node 24)
pnpm run e2e:firefox  # the core specs on Firefox/Gecko (opt-in; Vite-only, no Node 24)
pnpm run e2e:browsers # the core specs on ALL 3 engines: Chromium + WebKit + Firefox (Vite-only, no Node 24)
pnpm run e2e:all      # e2e:browsers PLUS the Chromium-only db/auth server specs (needs the servers + Node 24)
```

The `server/` workspace is kept out of the root `gate` (it needs Node's `node:sqlite`, no
browser build); run it separately with `gate:server`. CI (`.github/workflows/gate.yml`)
runs `gate`, `gate:server`, and the Chromium E2E on every pull request, on release tags,
and on demand — but **not on every push**, so keep running the gate locally before pushing.
Pull requests (and manual runs) additionally run a `docker` job that builds both images and
smoke-tests the Compose + Nginx deployment (`/api/health`, the security headers, and the 6 MB
request-body limit). Node 24+ (`.nvmrc`).

`e2e` is Chromium by default (the fast inner loop) — but a plain `pnpm run e2e` (no
`--project` filter) runs **all three** Chromium-flavoured projects at once: `chromium`
(the core specs), `db-backed`, and `auth-backed`. That boots three Vite dev servers plus
the SQLite and auth API servers, so it needs **Node 24** even though "Chromium" is the
headline. The core specs run against the **demo/localStorage build** (Vite-only, via
`dev:demo`); the db-backed/auth-backed specs exercise real server round-trips.
Cross-engine coverage of the **core specs only** is opt-in: `e2e:webkit` / `e2e:firefox`
run a single engine, and **`e2e:browsers` runs the core specs on all three** (Chromium +
WebKit, then Firefox). All of these boot **only** the Vite dev server, so they need
neither the SQLite/auth servers nor Node 24 and run anywhere the app builds. `e2e:all` is
the superset — `e2e:browsers` plus the Chromium-only db/auth server specs (so it needs
the servers + Node 24, same as plain `pnpm run e2e`). In both `e2e:browsers` and
`e2e:all`, WebKit runs first and Firefox second, both always run, and the run fails if
either engine fails. The db-backed/auth-backed specs stay Chromium-only (they exercise
server round-trips, not cross-engine rendering). Keep specs browser-agnostic — no UA
branching.

> **Stop `pnpm run dev` before running `pnpm run e2e`.** Both bind **:5173**, and e2e
> deliberately does NOT reuse a running dev server (`reuseExistingServer: false`) — a
> reused server-mode dev server would corrupt the demo/localStorage specs — so it boots
> its own. With `pnpm run dev` still holding the strict port, `pnpm run e2e` fails to
> start. Kill the dev server first.

**Mutation testing** (`pnpm run mutation`, Stryker over the pure core + src helpers) is
the on-demand "do the tests bite?" oracle — deliberately off the gate (~15–30 min a run).

## README screenshots

`docs/screenshots/schedule-{light,dark}.png` are captured from `pnpm run dev:demo` at
1440×900@2x with the browser clock frozen to **2026-06-03** (inside the seed dataset's
June 2026 window — same trick as `e2e/helpers.ts`, where the rationale is documented).
To refresh them after a visual change, drive the same path: fake sign-in → Studio North →
intro → screenshot, in both themes (`localStorage['capacitylens/theme']`).
