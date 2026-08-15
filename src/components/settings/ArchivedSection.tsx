import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { isServerConfigured } from "../../data/apiConfig";
import { fetchInactiveSlice, InactiveSliceHttpError, InactiveSliceShapeError } from "../../data/fetchInactiveSlice";
import { useStore, type LifecycleEntity } from "../../store/useStore";
import { useInactiveScopedData } from "../../store/useScopedData";
import { useLifecycleActions } from "../../hooks/useLifecycleActions";
import { useCan } from "../../auth/permissionContext";
import { useExclusiveAction } from "../../hooks/useExclusiveAction";
import { useDeadlineClock } from "../../hooks/useDeadlineClock";
import { errorMessage } from "../../lib/errorMessage";
import { ConfirmDialog } from "../common/ui";
import { Button } from "../ui/button";
import { m } from "@/i18n";
import { canPurge, lifecycleStatus, PURGE_MIN_AGE_DAYS } from "@capacitylens/shared/domain/lifecycle";
import { nameForQuotedContext } from "@capacitylens/shared/domain/privateNames";
import type { AppData, Client, Project, Resource } from "@capacitylens/shared/types/entities";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { SettingsSection } from "./SettingsSection";

// Settings → "Archived & deleted" — the client-admin view of the data-lifecycle (P2.5b), the
// COUNTERPART to the normal active-only views. It lists the resources/clients/projects the scheduler
// and management lists HIDE (archived + soft-deleted tombstones) and drives the lifecycle transitions
// through `useLifecycleActions` (which branches server/local — see that hook). Modeled on
// MembersSection: in SERVER mode it self-gates on a 403 from the inactive read and re-fetches on a
// `reloadKey` bump; in the DEMO build it always renders (everyone is owner locally) and reads the
// inactive rows straight from the store via `useInactiveScopedData`.

// One inactive row, normalised across the three lifecycle tables so the two groups (archived /
// tombstone) render uniformly. `entity` is the table key the dispatch + the type tag need; `name` is
// the already-display-ready label (a deleted resource's name is the server/store-scrubbed
// "Removed person #…", which we render verbatim).
interface Row {
  entity: LifecycleEntity;
  id: string;
  name: string;
  /** The raw lifecycle-bearing record — fed to `canPurge` to gate the permanent-delete button. */
  raw: Resource | Client | Project;
}

// A row's display name: prefer the stored `name` (a resource tombstone's is the obfuscated token),
// fall back to a resource's `role` for a nameless placeholder/external. Clients/projects always carry
// a name. Kept local (not resourceDisplayName) so a placeholder tombstone shows its scrubbed name/role
// rather than the generic "Placeholder" label the scheduler uses.
function rowName(entity: LifecycleEntity, e: Resource | Client | Project): string {
  if (entity === "resources") {
    const r = e as Resource;
    return r.name ?? r.role;
  }
  return (e as Client | Project).name;
}

// Collect every NON-active row across the three tables into a flat list, preserving entity identity.
function collectInactive(data: AppData): Row[] {
  const out: Row[] = [];
  const push = (entity: LifecycleEntity, list: (Resource | Client | Project)[]) => {
    for (const e of list) {
      if (lifecycleStatus(e) !== "active") out.push({ entity, id: e.id, name: rowName(entity, e), raw: e });
    }
  };
  push("resources", data.resources);
  push("clients", data.clients);
  push("projects", data.projects);
  return out;
}

/** Confirmation messages add their own quotes. Strip the read projection's outer quote pair from a
 * private client/project first so a code name still appears with exactly one pair. */
function confirmationName(row: Row): string {
  if (row.entity === "resources") return row.name;
  return (row.raw as Client | Project).isPrivate === true ? nameForQuotedContext(row.name) : row.name;
}

const TYPE_LABEL: Record<LifecycleEntity, () => string> = {
  resources: () => m.settings_archived_type_resources(),
  clients: () => m.settings_archived_type_clients(),
  projects: () => m.settings_archived_type_projects(),
};

/** Which destructive transition a confirmation dialog is standing in front of. The two share one
 *  piece of state (and one dialog) because only one can ever be open: opening either parks the row
 *  it applies to, and the copy below switches on `kind`. */
type Confirmation = { kind: "delete" | "purge"; row: Row };

/**
 * One lifecycle group — a heading over a separated list of inactive rows.
 *
 * The archived and tombstone groups render the SAME row (name · type label); they differ only in the
 * controls on the right, which the caller supplies through {@link rowActions} (returning `null` when
 * the viewer may not act on that row at all). An empty group renders nothing, so the section's own
 * "nothing archived or deleted" line stays the single empty state.
 */
function LifecycleGroup({
  heading,
  rows,
  rowTestId,
  rowActions,
}: {
  heading: string;
  rows: Row[];
  rowTestId: string;
  rowActions: (row: Row) => ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="mb-1 text-xs font-semibold text-ink">{heading}</h3>
      <ItemGroup>
        {rows.map((r, index) => (
          <Fragment key={`${r.entity}-${r.id}`}>
            {index > 0 && <ItemSeparator />}
            <Item size="sm" role="listitem" className="rounded-none px-0" data-testid={rowTestId}>
              <ItemContent className="min-w-0">
                <span className="text-sm text-ink">{r.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">· {TYPE_LABEL[r.entity]()}</span>
              </ItemContent>
              {rowActions(r)}
            </Item>
          </Fragment>
        ))}
      </ItemGroup>
    </div>
  );
}

/**
 * The Settings → "Archived & deleted" admin view (P2.5b). Partitions the inactive rows into Archived
 * (restore / delete) and Deleted-tombstone (permanently delete) groups and drives each transition
 * through the shared {@link useLifecycleActions} dispatch. SERVER mode fetches the inactive slice with
 * `?includeInactive=1` and self-hides on a 403 (admin-tier gate); the DEMO build reads it from the store
 * and always renders. Delete and permanent-delete affordances are gated by the purge role tier; the
 * permanent-delete button is additionally gated by `canPurge` until the 30-day grace elapses. The
 * server remains the authorization backstop.
 */
export function ArchivedSection({
  collapsible = false,
  defaultOpen = true,
}: {
  collapsible?: boolean;
  defaultOpen?: boolean;
} = {}) {
  const server = isServerConfigured();
  const activeAccountId = useStore((s) => s.activeAccountId);
  const setNotice = useStore((s) => s.setNotice);
  // Stable, render-unique base for the per-row "30-day locked" hint ids, so each disabled purge
  // button can point its aria-describedby at its OWN hint (suffixed with entity-id below). Without
  // this a screen reader announces only "Permanently delete {name}" with no reason it's disabled.
  const hintBaseId = useId();

  // Soft-delete and purge share the admin tier: in OFF/local the role is null (full access); on an
  // auth-on server only admin+ may perform either transition. The server is the backstop; this gate
  // keeps both destructive affordances out of a non-purger's rendered controls.
  //
  // A NULL ROLE MUST STAY PERMITTED. `useCan` resolves a null role — OFF mode, the demo build, a
  // providerless render — to `true` for every action, and this section depends on that: the shipped
  // no-login deploy has no role to enforce and must keep every lifecycle control. Anything that
  // narrows this to "a concrete role that can purge" silently strips the demo build bare.
  const mayPurge = useCan("purge");
  // In SERVER mode the same tier decides whether the section EXISTS. The ?includeInactive=1 read is
  // the heaviest read in the app, and it 403s for anyone who can't purge — so a concrete non-purge
  // role skips it entirely instead of paying for a request whose only outcome is self-hiding. The
  // 403 gate below stays as the server-authoritative backstop; this only avoids asking.
  const sectionEnabled = !server || mayPurge;

  // DEMO-build source: the raw scoped slice (active + archived + deleted), filtered below.
  const localData = useInactiveScopedData();

  // SERVER-mode source: an ?includeInactive=1 fetch, with the MembersSection 403-self-hide gate.
  const [serverRows, setServerRows] = useState<{
    accountId: string;
    reloadKey: number;
    rows: Row[];
  } | null>(null);
  const [gate, setGate] = useState<"loading" | "shown" | "hidden">(server ? "loading" : "shown");
  // Bumped after every successful mutation to re-run the inactive fetch (server) — the MembersSection
  // reloadKey idiom. (The demo build re-renders off the store directly, so the bump is a harmless no-op.)
  const [reloadKey, setReloadKey] = useState(0);
  const requestGeneration = useRef(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Confirm-dialog target: a soft-delete (archived → tombstone) and a permanent purge each need
  // confirmation, so park the pending row + which transition it is until the user confirms
  // (null = no dialog open).
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  // Section-wide exclusion: a restore, a delete and a purge all mutate the same list and each ends in
  // an authoritative reload, so only one may be in flight at a time.
  const { busy: lifecycleBusy, run, locked } = useExclusiveAction();

  const actions = useLifecycleActions(reload);
  const runLifecycle = useCallback(
    (action: () => Promise<void>) => run(action, (error: unknown) => setNotice(errorMessage(error), "error")),
    [run, setNotice],
  );

  useEffect(() => {
    if (!server || !mayPurge || !activeAccountId) return;
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    let cancelled = false;
    const current = () => !cancelled && requestGeneration.current === generation;
    void (async () => {
      try {
        // The shared, body-validating reader of the ?includeInactive=1 admin endpoint (also
        // DeleteCompanyDialog's "Export first" source) — it structure-checks the untrusted body
        // before migrate(), so a proxy error page / wrong-version partial can no longer render
        // here as a silently EMPTY archived list; it lands in the catch below instead.
        const body = await fetchInactiveSlice(activeAccountId, controller.signal);
        if (!current()) return;
        setServerRows({
          accountId: activeAccountId,
          reloadKey,
          rows: collectInactive(body),
        });
        setGate("shown");
      } catch (e) {
        if (!current()) return;
        if (e instanceof InactiveSliceHttpError && e.status === 403) {
          setServerRows(null);
          setGate("hidden"); // a non-admin asked for the inactive slice — hide the whole section.
          return;
        }
        // Every other failure keeps the section visible and surfaces a notice: prefer the
        // server's own sentence off a non-OK response, then this section's status-stamped or
        // incomplete-body message, then the raw network/parse error.
        setServerRows(null);
        setGate("shown");
        if (e instanceof InactiveSliceHttpError) {
          setNotice(e.serverMessage ?? m.settings_archived_err_load({ status: e.status }), "error");
        } else if (e instanceof InactiveSliceShapeError) {
          setNotice(m.settings_archived_err_incomplete(), "error");
        } else {
          setNotice(m.settings_err_server({ error: errorMessage(e) }), "error");
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [server, mayPurge, activeAccountId, reloadKey, setNotice]);

  // The rows to render: server fetch in server mode, the store slice in the demo build.
  const rows = useMemo(
    () =>
      server
        ? serverRows?.accountId === activeAccountId && serverRows.reloadKey === reloadKey
          ? serverRows.rows
          : []
        : collectInactive(localData),
    [server, serverRows, activeAccountId, reloadKey, localData],
  );
  // One pass, two groups: every inactive row is either archived or a tombstone, and each group's
  // status is read once rather than re-derived per filter.
  const archived: Row[] = [];
  const deleted: Row[] = [];
  for (const row of rows) {
    const status = lifecycleStatus(row.raw);
    if (status === "archived") archived.push(row);
    else if (status === "deleted") deleted.push(row);
  }
  // The alarm that re-renders this section just after the nearest tombstone's 30-day grace elapses,
  // so a mounted row un-disables itself at the boundary instead of on the next unrelated render.
  // The picker is asked with the clock the hook is about to return, and filters against THAT (not a
  // fresh `Date.now()`): dropping the deadlines this clock has already passed is what lets the alarm
  // work down a queue of tombstones — each wake retires the boundary just crossed and arms the next.
  const purgeClock = useDeadlineClock((clock) =>
    deleted.reduce<number | null>((nearest, row) => {
      const deletedAt = row.raw.deletedAt ? Date.parse(row.raw.deletedAt) : Number.NaN;
      if (!Number.isFinite(deletedAt)) return nearest;
      const candidate = deletedAt + PURGE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
      if (candidate <= clock) return nearest;
      return nearest === null || candidate < nearest ? candidate : nearest;
    }, null),
  );

  // Server mode and a concrete role that can't purge — nothing was fetched, so there is nothing to show.
  if (!sectionEnabled) return null;
  // Server mode but the section isn't cleared to show yet — a 403 self-gated it, or the inactive fetch is still loading.
  if (server && gate !== "shown") return null;

  return (
    <>
      <SettingsSection
        title={m.settings_archived_heading()}
        help={m.settings_archived_intro()}
        testId="archived-section"
        collapsible={collapsible}
        defaultOpen={defaultOpen}
        contentClassName="gap-4"
      >
        {rows.length === 0 && <p className="py-2 text-sm text-muted-foreground">{m.settings_archived_empty()}</p>}

        {/* Archived group — restore (→ active) or delete (→ tombstone). */}
        <LifecycleGroup
          heading={m.settings_archived_group_archived()}
          rows={archived}
          rowTestId="archived-row"
          rowActions={(r) => (
            <ItemActions>
              <Button
                size="sm"
                variant="outline"
                data-testid="archived-restore"
                disabled={lifecycleBusy}
                aria-label={m.settings_archived_restore_aria({
                  name: r.name,
                })}
                onClick={() => runLifecycle(() => actions.unarchive(r.entity, r.id))}
              >
                {m.settings_archived_restore()}
              </Button>
              {mayPurge && (
                <Button
                  size="sm"
                  variant="danger-soft"
                  data-testid="archived-delete"
                  disabled={lifecycleBusy}
                  aria-label={m.settings_archived_delete_aria({
                    name: r.name,
                  })}
                  onClick={() => {
                    // `locked()` reads the synchronous ref: it refuses to open the dialog inside the
                    // same click that started a mutation, before React has committed `busy`.
                    if (!locked()) setConfirming({ kind: "delete", row: r });
                  }}
                >
                  {m.settings_archived_delete()}
                </Button>
              )}
            </ItemActions>
          )}
        />

        {/* Deleted (tombstone) group — permanent purge, gated by canPurge + the purge role tier. */}
        <LifecycleGroup
          heading={m.settings_archived_group_deleted()}
          rows={deleted}
          rowTestId="deleted-row"
          rowActions={(r) => {
            if (!mayPurge) return null;
            // Exact-instant "now", not date-only midnight: a midnight-truncated timestamp would
            // let the client stay up to ~24h more conservative than the server's own boundary check.
            const purgeable = canPurge(r.raw, new Date(purgeClock).toISOString());
            // The "locked" hint only renders (and is only referenced) while the purge button is
            // disabled, so a screen reader hears WHY it can't act yet, not just the button name.
            const hintId = `${hintBaseId}-${r.entity}-${r.id}`;
            return (
              <ItemActions>
                {!purgeable && (
                  <span id={hintId} className="text-xs text-muted-foreground">
                    {m.settings_archived_purge_locked_hint({
                      days: PURGE_MIN_AGE_DAYS,
                    })}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="danger-soft"
                  data-testid="archived-purge"
                  disabled={lifecycleBusy || !purgeable}
                  aria-label={m.settings_archived_purge_aria({
                    name: r.name,
                  })}
                  aria-describedby={!purgeable ? hintId : undefined}
                  onClick={() => {
                    // Same same-render guard as the delete button above.
                    if (!locked()) setConfirming({ kind: "purge", row: r });
                  }}
                >
                  {m.settings_archived_purge()}
                </Button>
              </ItemActions>
            );
          }}
        />
      </SettingsSection>
      {confirming && (
        <ConfirmDialog
          title={confirming.kind === "delete" ? m.settings_archived_delete_title() : m.settings_archived_purge_title()}
          message={
            confirming.kind === "delete"
              ? m.settings_archived_delete_message({ name: confirmationName(confirming.row) })
              : m.settings_archived_purge_message({ name: confirmationName(confirming.row) })
          }
          confirmLabel={
            confirming.kind === "delete" ? m.settings_archived_delete() : m.settings_archived_purge_confirm()
          }
          onConfirm={() => {
            const { kind, row } = confirming;
            runLifecycle(() =>
              kind === "delete" ? actions.softDelete(row.entity, row.id) : actions.purge(row.entity, row.id),
            );
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
