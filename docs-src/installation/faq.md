---
title: Installation FAQ
description: Answers to common questions about installation routes, sign-in and technical handover.
next: false
---

# Installation FAQ

These answers cover decisions that commonly arise while putting CapacityLens on a server.

## Do I need Docker?

No. The release archive runs on Node 24 alone, on a managed VPS platform or a Linux host.
Docker Compose is another way to install; follow only the prerequisites of the route you choose.

## Is the local demo an installation route?

No. The demo uses temporary in-memory data and is designed for evaluation. It must not be
used to store real scheduling data.

## Which Node version should I use?

Node 24, installed so the service can run it. Do not assume the machine's default Node is
compatible: the server stops at start-up on an older version and says so.

## Who chooses the company name and calendar rules?

The first Owner does. The installer supplies a working service and first-Owner sign-in
route, then hands over to the [Owner setup guide](/owner/).

## Who owns backups after installation?

Name an operator before handover. They should follow [Backups and restore](/self-hosting/backups-and-restore),
monitor backup freshness, and test recovery.

## Can I expose CapacityLens directly without TLS?

Do not expose credentials or session traffic over an unencrypted internet connection.
Follow [TLS and networking](/self-hosting/tls-and-networking) for the supported topology.

## What's next

Return to [Technical installation](/installation/).
