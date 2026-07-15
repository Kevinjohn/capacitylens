# Release checklist

## Scope

- [ ] Version bump matches SemVer and pre-1.0 policy.
- [ ] Changelog Unreleased entries are complete and moved under the version/date.
- [ ] Breaking/migration notes are explicit.
- [ ] Root/server/shared versions are aligned where released together.

## Verification

- [ ] `pnpm run gate`.
- [ ] `pnpm run gate:server`.
- [ ] `pnpm run e2e`.
- [ ] Cross-browser/mutation checks required for this change.
- [ ] Production Docker/Compose smoke.
- [ ] Production dependency audit.
- [ ] GitHub CI decision follows version policy.

## Security and data

- [ ] Tenant/role/privacy review for changed routes/fields.
- [ ] Migration/import/fixtures/SQL columns complete.
- [ ] If backups are enabled, a current snapshot and recent restore drill are confirmed.
- [ ] If disaster recovery requires it, the current off-host copy is confirmed.
- [ ] No secrets, real data or generated reports in commit.

## Documentation

- [ ] README/product docs.
- [ ] Operator/auth/offline/privacy/runbook.
- [ ] User-story reference/stories.
- [ ] Agent/decision/defensive standards.
- [ ] Internal sibling notes reviewed separately when the owner is intentionally distilling a reusable pattern.

## Publish

- [ ] Clean intended diff reviewed.
- [ ] DCO/sign-off.
- [ ] Commit/tag created from green source.
- [ ] Artifacts/images built from tag.
- [ ] Release notes link changelog/migrations.

## Deploy

- [ ] Old process stopped at activation handoff.
- [ ] Persistent state remains outside release directory.
- [ ] Health through public proxy.
- [ ] Sign-in and tenant access.
- [ ] One safe write and read-back.
- [ ] Logs/audit/backups healthy.
- [ ] Previous image/release retained for rollback.
