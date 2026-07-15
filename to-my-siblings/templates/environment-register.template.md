# Environment register template

The real `.env.example` should be runnable documentation, not merely variable names.

## Header

- State server runtime versus client build-time difference.
- State restart versus rebuild.
- State boolean parsing convention.
- Warn never to commit real secrets.
- Explain empty versus unset where relevant.

## Server runtime

For each variable include:

```dotenv
# PURPOSE. Default VALUE. Accepted RANGE/VALUES.
# Production/security consequence. Restart/rebuild note.
PRODUCT_VARIABLE=value
```

Cover:

- port/bind;
- database path;
- backup directory/interval/retention;
- CORS;
- concurrency/conflict posture;
- HTTPS/HSTS;
- structured logs;
- deep health;
- rate limit/trusted proxy;
- multi-account/org provisioning;
- demo seed/test reset;
- audit path/rotation.

## Authentication

Cover:

- auth mode;
- session secret minimum/generation;
- public auth URL;
- first-owner setup token;
- open signup risk;
- auth-off production risk acceptance;
- bootstrap operator path;
- every social provider id/secret pair;
- OIDC discovery or explicit endpoints;
- OIDC scopes/provider id/label;
- verified-email/bootstrap invitation rule.

## Client build-time

Cover:

- API origin (and whether it includes `/api`);
- explicit demo flag;
- build SHA;
- feedback/support address;
- analytics only if deliberately present.

## Process

Cover:

- `NODE_ENV`;
- shutdown/deadline configuration if exposed;
- worker/process role if the sibling adds one.

## Validation checklist

- Every `process.env` / `import.meta.env` read appears here.
- Defaults match code/tests.
- Numeric bounds match parser.
- Secret values are placeholders.
- Production-danger flags are visibly labelled.
- Compose passes only intended variables.
- Client values are not mistaken for runtime-configurable after build.
