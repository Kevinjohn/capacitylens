import { useCallback, useRef } from "react";
import { API_BASE, isServerConfigured } from "../data/apiConfig";
import { persistenceAdapter } from "../data/storageAdapter";
import { refreshActiveAccountSlice, type RefreshOutcome } from "../data/persist";
import { useStore, type LifecycleEntity } from "../store/useStore";
import { errorMessage } from "../lib/errorMessage";
import { readApiError } from "../lib/readApiError";
import { m } from "@/i18n";
import { apiFetchReauth } from "../auth/apiFetchReauth";
import { API_BULK_TIMEOUT_MS } from "../data/requestTimeout";

// The SINGLE dispatch seam for the Active → Archived → Soft-deleted → Purged data-lifecycle (P2.5b),
// shared by BOTH the management lists' Archive affordance (ResourceList/ClientList/ProjectList) and
// the Settings → "Archived & deleted" admin view (ArchivedSection). Extracted so the server/local
// branch + the post-mutation reload live in ONE place rather than being duplicated across four call
// sites.
//
// THE BRANCH (the decided architecture — see CLAUDE.md / P2.5b brief):
//   • SERVER mode (`isServerConfigured()` true): lifecycle mutations are SERVER-AUTHORITATIVE so the
//     interlocks (delete-needs-archived, purge tier + 30-day grace, resource-name PII obfuscation)
//     stay enforced server-side. The UI POSTs the dedicated P2.5a route (modeled on MembersSection's
//     hand-rolled fetches) and then RELOADS the active slice from the server — those routes write the
//     DB OUT-OF-BAND from the snapshot-diff sync, so without a reload the scheduler/lists wouldn't
//     reflect the change AND the adapter's diff snapshot would desync (next ordinary edit would emit a
//     spurious/garbage delta). On a non-OK response we surface `body.error` (a <30d purge → 409, a
//     non-admin purge / non-member → 403) and never crash. HTTP 408/5xx cannot prove whether an
//     intermediary returned after commit, so those enter the same authoritative-reload recovery as
//     a thrown transport failure before another destructive attempt is allowed.
//   • DEMO build (`isServerConfigured()` false — VITE_CAPACITYLENS_DEMO=1): the UI calls the store action, which mutates the
//     local `data` blob immediately through the same mutate()/undo machinery (no fetch, no reload).
//     We wrap it in try/catch and surface the throw — these are the store's deliberate display-safe
//     integrity throws (builtin-Internal guard, illegal-transition backstop), exactly the ones the UI
//     pre-gates with the shared can* predicates but must still surface if they fire.

/** A lifecycle transition verb. Mirrors the four dedicated server routes + the four store actions. */
export type LifecycleVerb = "archive" | "unarchive" | "delete" | "purge";

/** A timeout or server/intermediary failure cannot prove whether the dispatched write committed. */
function lifecycleOutcomeUnknown(response: Response): boolean {
  return response.status === 408 || response.status >= 500;
}

/**
 * The dispatch surface returned by {@link useLifecycleActions}. Each method runs ONE lifecycle
 * transition for one entity row, branching server vs local internally. They are async because the
 * SERVER path awaits the route POST + the reload; in the demo build they resolve synchronously after the
 * store mutation. The promise NEVER rejects — a failure is surfaced as a notice and the promise still
 * resolves, so a caller can `void` it without an unhandled rejection (the MembersSection idiom).
 */
export interface LifecycleActions {
  archive: (entity: LifecycleEntity, id: string) => Promise<void>;
  unarchive: (entity: LifecycleEntity, id: string) => Promise<void>;
  /** Soft-delete (archived → tombstone; a resource's name is scrubbed server- or store-side). */
  softDelete: (entity: LifecycleEntity, id: string) => Promise<void>;
  /** Hard-purge a ≥30-day tombstone (admin-only / purge tier server-side). */
  purge: (entity: LifecycleEntity, id: string) => Promise<void>;
}

/**
 * Re-hydrate the ACTIVE account's slice from the server after a server-mode lifecycle route call, so
 * the active views (scheduler / lists) reflect the out-of-band DB write AND the adapter's diff
 * snapshot is re-seeded (else the next ordinary edit would emit a spurious cross-snapshot delta).
 *
 * REUSE, not a hand-roll: this goes THROUGH the persist orchestrator
 * ({@link refreshActiveAccountSlice} → persist.ts `refreshActive`), the same sequence tenant switches
 * and refresh-on-focus use — it FLUSHES a still-debounced ordinary edit and awaits any in-flight save
 * BEFORE reloading, and skips the reload entirely while a save is in a failed state. A bare
 * `loadAll` + `replaceAll` here would race those: an edit inside the debounce window when the reload
 * lands would be replaced by the server slice AND the snapshot re-seeded under it, so the queued save
 * diffs to zero ops and the edit is silently, permanently lost. (When the reload is skipped on a
 * failed save, the lifecycle change is already committed server-side — it appears on the next
 * successful refresh; preserving the un-persisted edit wins.)
 *
 * The bare-reload fallback runs when no orchestrator is attached: normally unit tests and
 * pre-bootstrap, but also production after a bootstrap hard failure leaves server persistence
 * unattached. With no orchestrator there is no debounce/retry state to clobber. The demo build
 * never calls this (its store actions already mutate `data`).
 */
type LifecycleReloadOutcome = Exclude<RefreshOutcome, "unattached"> | "stale-account";

async function reloadFromServer(accountId: string): Promise<LifecycleReloadOutcome> {
  // STALE-TENANT GUARD: the lifecycle POST may resolve AFTER the user switched company, so re-read
  // the CURRENT active account and skip the reload when it no longer matches the account the
  // mutation ran in. The mutation already committed server-side (it shows on that account's next
  // hydration); the slice for the NEW tenant is being loaded by the switch orchestrator, and this
  // stale reload must not fight it — the bare fallback below would install the OLD tenant's slice
  // under the NEW active id (cross-tenant display → cross-tenant writes). persist.ts's
  // refreshActive carries the same guard at its own altitude; this one also covers the fallback.
  if (useStore.getState().activeAccountId !== accountId) return "stale-account";
  // Anything but 'unattached' means the orchestrator OWNED the call — including 'skipped' (a
  // failed save's edits win; the committed change appears on the next successful refresh) and
  // 'failed' (surfaced via the persist banner). Only the no-orchestrator case may fall back.
  const outcome = await refreshActiveAccountSlice(accountId);
  // `skipped` also covers an orchestrator superseded by a tenant switch. Re-check ownership so the
  // caller can keep that deliberate stale-tenant outcome silent while treating a same-tenant skip
  // (normally a failed save that must not be overwritten) as committed-but-stale.
  if (useStore.getState().activeAccountId !== accountId) return "stale-account";
  if (outcome !== "unattached") return outcome;
  const slice = await persistenceAdapter.loadAll(accountId);
  // The bare load is asynchronous too. A switch can happen after the pre-load guard but before the
  // old slice arrives, so check ownership again at the exact store-install boundary.
  if (useStore.getState().activeAccountId !== accountId) return "stale-account";
  useStore.getState().replaceAll(slice);
  return "reloaded";
}

function committedButStaleMessage(outcome: "skipped" | "failed", cause?: unknown): string {
  const guidance =
    outcome === "skipped"
      ? m.settings_archived_committed_refresh_skipped()
      : m.settings_archived_committed_refresh_failed();
  return cause === undefined ? guidance : `${guidance} ${errorMessage(cause)}`;
}

// A confirmed mutation without its mandatory refresh must stay gated across route/component
// remounts: the same stale store slice is shared across those surfaces. Module lifetime matches the
// required recovery boundary — a full page reload boots, hydrates, and creates a fresh gate map.
const reloadRequiredByAccount = new Map<string, string>();

/**
 * The lifecycle dispatch hook (P2.5b). Returns {@link LifecycleActions} whose methods branch
 * server-vs-local per the module header. An optional `onReloaded` callback fires after a SUCCESSFUL
 * server-mode mutation + reload — the admin section passes a `reloadKey` bump so its own
 * `?includeInactive=1` list re-fetches (the MembersSection idiom); the lists pass nothing (the active
 * view already re-renders off the reloaded store `data`).
 *
 * @param onReloaded - optional; called once after each successful server-mode mutation completes its
 *                     reload, so a caller maintaining its own inactive-row list can re-fetch it.
 */
export function useLifecycleActions(onReloaded?: () => void): LifecycleActions {
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const activeAccountId = useStore((s) => s.activeAccountId);
  const setNotice = useStore((s) => s.setNotice);
  const archiveEntity = useStore((s) => s.archiveEntity);
  const unarchiveEntity = useStore((s) => s.unarchiveEntity);
  const softDeleteEntity = useStore((s) => s.softDeleteEntity);
  const purgeEntity = useStore((s) => s.purgeEntity);

  // The single server-mode dispatch: POST the dedicated route with {accountId}, reconcile an
  // ambiguous timeout/5xx, surface body.error on a definitive non-OK reply, else reload the active
  // slice + ping onReloaded. Mirrors MembersSection's fetches.
  const dispatchServer = useCallback(
    async (verb: LifecycleVerb, entity: LifecycleEntity, id: string) => {
      if (!activeAccountId) return;
      const reloadRequiredMessage = reloadRequiredByAccount.get(activeAccountId);
      if (reloadRequiredMessage) {
        setNotice(reloadRequiredMessage, "error");
        return;
      }
      let notifyReloaded = false;
      let mutationConfirmed = false;
      try {
        // apiFetchReauth (not raw fetch) so: (1) the server's `x-capacitylens-audit-warning` header
        // on these destructive lifecycle writes is surfaced (announceAuditWarning) exactly like
        // ordinary edits and the shared request-timeout signal is attached (both via apiFetch); and
        // (2) `delete` and `purge` — the security-sensitive lifecycle verbs (soft-delete is
        // irreversible and destroys resource PII, so the server freshness-gates both) — that 403
        // SESSION_NOT_FRESH raise the step-up dialog and retry after re-auth (DEFECT B).
        // archive/unarchive are ordinary writes and never trip freshness, so this is a no-op there.
        const res = await apiFetchReauth(
          `${API_BASE}/api/${entity}/${encodeURIComponent(id)}/${verb}`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({ accountId: activeAccountId }),
          },
          API_BULK_TIMEOUT_MS,
        );
        if (lifecycleOutcomeUnknown(res)) {
          throw new Error(`HTTP ${res.status} did not confirm whether the lifecycle mutation committed.`);
        }
        if (!res.ok && res.status !== 204) {
          // A <30d / non-admin purge is a 409/403 with a server message — show it, never crash.
          setNotice((await readApiError(res)) ?? m.settings_archived_err_action({ status: res.status }), "error");
          return;
        }
        mutationConfirmed = true;
        // The dedicated routes write the DB out-of-band from the snapshot-diff sync, so a reload is
        // REQUIRED to refresh the active views + re-seed the adapter snapshot (see reloadFromServer).
        const outcome = await reloadFromServer(activeAccountId);
        if (outcome === "stale-account") return;
        if (outcome !== "reloaded") {
          const message = committedButStaleMessage(outcome);
          reloadRequiredByAccount.set(activeAccountId, message);
          setNotice(message, "error");
          return;
        }
        notifyReloaded = true;
      } catch (e) {
        // A route change during the request makes this reconciliation intentionally stale. The
        // original company will hydrate its committed state when selected again; do not attach an
        // alarming old-company notice to the picker or the newly active company.
        if (useStore.getState().activeAccountId !== activeAccountId) return;
        if (mutationConfirmed) {
          const message = committedButStaleMessage("failed", e);
          reloadRequiredByAccount.set(activeAccountId, message);
          setNotice(message, "error");
          return;
        }
        try {
          const outcome = await reloadFromServer(activeAccountId);
          if (outcome === "stale-account") return;
          if (outcome !== "reloaded") {
            throw new Error(`Authoritative reload did not complete (${outcome}).`, { cause: e });
          }
          notifyReloaded = true;
          setNotice(
            `The lifecycle request had an unknown outcome, so the latest company data was reloaded. ${errorMessage(e)}`,
            "warning",
          );
        } catch (reloadError) {
          if (useStore.getState().activeAccountId !== activeAccountId) return;
          const message = `The lifecycle request had an unknown outcome and could not be reconciled. Reload before retrying. ${errorMessage(reloadError)} Original request: ${errorMessage(e)}`;
          reloadRequiredByAccount.set(activeAccountId, message);
          setNotice(message, "error");
        }
      }
      if (notifyReloaded) onReloaded?.();
    },
    [activeAccountId, setNotice, onReloaded],
  );

  // The single demo-build dispatch: call the store action; wrap so the store's deliberate display-safe
  // throws (builtin-Internal guard, illegal-transition backstop) surface as a notice rather than a
  // React error. purgeEntity surfaces its own <30d notice and no-ops (doesn't throw), handled inside.
  const dispatchLocal = useCallback(
    (verb: LifecycleVerb, entity: LifecycleEntity, id: string) => {
      try {
        switch (verb) {
          case "archive":
            archiveEntity(entity, id);
            break;
          case "unarchive":
            unarchiveEntity(entity, id);
            break;
          case "delete":
            softDeleteEntity(entity, id);
            break;
          case "purge":
            purgeEntity(entity, id);
            break;
        }
      } catch (e) {
        setNotice(errorMessage(e), "error");
      }
    },
    [archiveEntity, unarchiveEntity, softDeleteEntity, purgeEntity, setNotice],
  );

  const run = useCallback(
    (verb: LifecycleVerb, entity: LifecycleEntity, id: string): Promise<void> => {
      const execute = async () => {
        try {
          if (isServerConfigured()) {
            await dispatchServer(verb, entity, id);
          } else {
            dispatchLocal(verb, entity, id);
          }
        } catch (e) {
          // Preserve the public never-reject contract even if a configuration seam or future
          // dispatch branch throws outside the existing server/local error boundaries.
          setNotice(errorMessage(e), "error");
        }
      };

      // Lifecycle routes mutate outside snapshot-diff sync, and each operation must complete its
      // authoritative reload before the next starts. Queue confirmed intent instead of silently
      // discarding a second click while the first transition is still settling.
      const scheduled = mutationQueue.current.then(execute, execute);
      mutationQueue.current = scheduled;
      return scheduled;
    },
    [dispatchServer, dispatchLocal, setNotice],
  );

  return {
    archive: useCallback((entity, id) => run("archive", entity, id), [run]),
    unarchive: useCallback((entity, id) => run("unarchive", entity, id), [run]),
    softDelete: useCallback((entity, id) => run("delete", entity, id), [run]),
    purge: useCallback((entity, id) => run("purge", entity, id), [run]),
  };
}
