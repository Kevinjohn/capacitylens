---
title: Ownership transfer recovery
description: Preserve a company database when an ownership transfer cannot complete; no offline transfer-repair command is provided.
---

# Ownership transfer recovery

Ownership changes use the in-product transfer flow and its authorization checks. The current
application does not provide an operator CLI command to cancel or rewrite a transfer record.
Do not edit ownership or membership tables with SQL.

If a transfer is pending, ask the current Owner and nominated member to use the action shown in
**Team & access**. Until acceptance completes, preserve the running installation and review the
service logs for the refusal. Do not create a second transfer to work around an uncertain result.

If the application reports corrupt or inconsistent database state, stop the service, preserve the
database and its recovery files, and check [Monitoring](/self-hosting/monitoring). Restore only from
a verified snapshot using [Backups and restore](/self-hosting/backups-and-restore), then confirm
readiness before retrying the in-product flow. If the cause remains unclear, contact support with
redacted diagnostics and no bearer links or customer data.
