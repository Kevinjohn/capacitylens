---
title: Ownership transfer recovery
description: Check company roles and gather diagnostics when an immediate ownership transfer has an uncertain outcome.
---

# Ownership transfer recovery

An Owner transfers ownership to an active, accessible Admin from **Team & access**. The transfer
takes effect immediately: the selected Admin becomes Owner and the former Owner becomes Admin in
one transaction. There is no nominee-acceptance step or pending transfer to complete later.

If the browser reports that the response was interrupted, do not assume the transfer rolled back.
Refresh the company membership view and check the actual roles in **Team & access**. If the
selected Admin is now Owner and the former Owner is Admin, the transfer completed. If the previous
roles remain, gather the relevant application and server diagnostics before considering another
attempt. Do not retry while the outcome is uncertain.

If the roles appear inconsistent, stop ownership changes and review the diagnostics. If the
application reports corrupt or inconsistent database state, stop the service and preserve the
database and its recovery files. Check [Monitoring](/self-hosting/monitoring) and contact support with redacted diagnostics;
do not include bearer links or customer data. Restore only from a verified snapshot using
[Backups and restore](/self-hosting/backups-and-restore) when recovery is necessary, then confirm
readiness before using the in-product transfer flow again. Do not rewrite transfer records or edit
ownership and membership tables directly.
