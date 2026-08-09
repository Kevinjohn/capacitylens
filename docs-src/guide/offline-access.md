---
title: Offline access
description: A read-only, seven-day snapshot of the schedule for checking capacity without a connection — never a way to edit offline.
---

# Offline access

Offline access is for reading the schedule on a train or a flaky connection, not for
editing it. This page covers what it does, what it deliberately doesn't do, and how to
turn it on.

::: warning
Offline access is read only. While you're viewing a cached [snapshot](/reference/glossary),
create, edit, delete, import and membership actions are all unavailable — CapacityLens
never queues an edit to apply later, and it never tries to merge one.
:::

## Turn it on

Offline access is off by default and turned on per device, not per company.

1. Sign in on the device you want to use offline.
2. Open [Settings](/guide/settings) and turn on **Make this device available offline**
   under **Offline access**.

Once it's on, CapacityLens keeps a copy of the last company you opened, stored on that
device only.

## What you get

- The schedule, people, projects and time off exactly as they last loaded successfully
  while you were online.
- Automatic use of that snapshot if a request can't reach the server at all — you'll
  see a banner explaining you're looking at cached data.

<!-- screenshot: Offline banner shown at the top of the schedule while viewing a cached snapshot -->

- A snapshot that's good for seven days. After that, it's gone, and you'll need a
  connection to see anything.

## What you don't get

- Any way to create, edit or delete anything while offline. The moment a cached
  snapshot is shown, your access drops to read only for everyone, regardless of your
  normal role.
- Edits that queue up and sync later. There's nothing to reconcile, because nothing was
  ever recorded. That's deliberate: you never lose work to a sync conflict, and you
  never discover that your "saved" changes went nowhere.
- Offline access for a company you haven't opened before, or one you haven't opened
  recently enough to still be within the seven-day window.

## When it refreshes

Every time you successfully load the schedule while online, the offline snapshot
updates in the background. If the server is reachable but returns an error, or a
request takes too long, CapacityLens shows a retry screen instead of silently falling
back to old data — so you're never looking at a stale schedule without knowing it.

## Turning it off

Turning off **Make this device available offline** in Settings — or signing out —
clears the cached snapshot and everything CapacityLens stored to protect it on that
device. **Clear device data**, further down the same Settings page, does the same
cleanup along with the rest of your local preferences, if you want to wipe the slate
without waiting.

::: warning
Don't turn on offline access on a shared or borrowed device. The cached snapshot is
encrypted on disk, but anyone using the browser while you're signed in can still see it
through the app itself, same as any other page.
:::

## What's next

[Settings](/guide/settings) covers the rest of the switches, and
[The schedule](/guide/the-schedule) covers what you're actually looking at, online or
off.
