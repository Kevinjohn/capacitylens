# Offline access

Offline access is designed for reading a schedule during unreliable travel, not for editing it.

It is off by default and must be enabled in Settings on each device. When enabled, CapacityLens
registers a service worker for the application shell and stores the last verified identity,
accessible account list and account snapshots in IndexedDB. Records expire after seven days.

Each snapshot is encrypted before storage with AES-256-GCM using a non-extractable, per-browser
device key held in a separate IndexedDB store. Every record has a fresh 96-bit random IV and binds
its cache key, creation time and record domain as authenticated additional data. Authentication-tag
failure, malformed data and expiry all delete the record instead of returning it. Upgrading from
the older plaintext cache schema clears those records rather than migrating them.

When a server request fails because the network is unavailable, a valid cached snapshot may be
shown with an offline banner. The effective role becomes `viewer`, so create, update, delete,
import and membership actions are unavailable. CapacityLens never queues a mutation for later and
never attempts to reconcile offline edits.

The cache is scoped to the browser origin and verified user id. Encryption reduces disclosure from
raw storage inspection and copied records, but it is not a substitute for full-disk encryption or a
locked device: JavaScript running in the unlocked application origin can ask the browser to use the
device key. Do not enable offline access on a shared, compromised or untrusted device.

Signing out clears that user's cached identity and snapshots before ending the server session.
“Clear device data” clears the offline cache and CapacityLens preferences. Browser or operating
system storage eviction can remove the cache earlier than seven days.

Application-shell caches are versioned and reconciled during service-worker upgrades so obsolete
hashed bundles are removed. Disabling offline access unregisters active, waiting and installing
CapacityLens workers before deleting all CapacityLens shell-cache versions.

Offline access does not change the server source of truth, backup requirements or session expiry.
