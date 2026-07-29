# Offline access

Offline access is designed for reading a schedule during unreliable travel, not for editing it.

It is off by default and must be enabled in Settings on each device. When enabled, CapacityLens
registers a service worker for the application shell and stores the last verified identity,
accessible account list and account snapshots in IndexedDB. Records expire after seven days.
Offline shell installation requires a production build; Vite development and demo servers reject
enablement because their on-demand module graph cannot be promoted as one complete immutable shell.

Each snapshot is encrypted before storage with AES-256-GCM using a non-extractable, per-browser
device key held in a separate IndexedDB store. Every record has a fresh 96-bit random IV and binds
its cache key, creation time and record domain as authenticated additional data. Authentication-tag
failure, malformed data and expiry all delete the record instead of returning it. Upgrading from
the older plaintext cache schema clears those records rather than migrating them.

When a server request fails because the network is unavailable—including a stalled request that
reaches its client deadline—a valid cached snapshot may be shown with an offline banner. The
effective role becomes `viewer`, so create, update, delete, import and membership actions are
unavailable. CapacityLens never queues a mutation for later and never attempts to reconcile offline
edits.

The cache is scoped to the browser origin, canonical configured API origin and verified user id.
Changing `VITE_CAPACITYLENS_API` on an existing web origin creates a new namespace: snapshots from
the previous backend are never considered, and expire through normal seven-day maintenance.
Encryption reduces disclosure from
raw storage inspection and copied records, but it is not a substitute for full-disk encryption or a
locked device: JavaScript running in the unlocked application origin can ask the browser to use the
device key. Do not enable offline access on a shared, compromised or untrusted device.

Signing out clears that user's cached identity and snapshots before ending the server session.
“Clear device data” clears the offline cache, its device encryption key and CapacityLens
preferences. Browser or operating system storage eviction can remove the cache earlier than seven
days. Cache maintenance physically removes expired records the next time the application opens or
writes the offline database.

Each service-worker installation stages its application shell in a private cache. Only a complete
shell is promoted for offline reads, so a failed upgrade leaves the active release unchanged.
Obsolete hashed bundles are removed after promotion. Disabling offline access removes every user's
encrypted identity and account snapshots plus the device encryption key, unregisters active,
waiting and installing CapacityLens workers, and deletes all shell caches and their metadata.

Offline access does not change the server source of truth, backup requirements or session expiry.
