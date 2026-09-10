# US-SET-05 — Copy privacy-safe diagnostics

**Area:** Settings · **Persona:** A person reporting a server problem

## Goal

Copy enough build and health context for support to identify a problem without copying company
data or credentials.

## Acceptance criteria

- Settings shows a Diagnostics card at the bottom in server and demo modes with a `Copy diagnostics` action.
- The projection includes only app version, validated build revision when available, deployment mode,
  export schema, server connectivity, database schema, persistence status and backup status/last
  success where observable.
- Unknown, offline, shallow-health, deep-health, missing-backup and error cases stay explicitly
  labelled and never fall back to a browser schema constant as the server schema. Demo mode keeps
  client facts and marks server values unavailable.
- Secret-like unknown fields, malformed types, raw errors, private paths/hostnames, PII and
  identifiers are ignored.
- A successful copy and a clipboard failure each produce generic user-visible feedback.
