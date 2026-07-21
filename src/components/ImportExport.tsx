import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useScopedData } from '../store/useScopedData'
import { parseData, serializeData } from '@capacitylens/shared/data/transfer'
import { downloadTextFile } from '../lib/download'
import { errorMessage } from '../lib/errorMessage'
import { readApiError } from '../lib/readApiError'
import { API_BASE, isServerConfigured } from '../data/apiConfig'
import { apiFetch, API_BULK_TIMEOUT_MS } from '../data/requestTimeout'
import { fetchInactiveSlice } from '../data/fetchInactiveSlice'
import { flushPendingWrites, refreshActiveAccountSlice, suspendServerWrites } from '../data/persist'
import { useRole } from '../auth/permissionContext'
import { can, canSeePrivateNames } from '@capacitylens/shared/domain/access'
import { ConfirmDialog, Modal } from './common/ui'
import { m } from '@/i18n'
import type { AppData } from '@capacitylens/shared/types/entities'
import { APP_NAME } from '@capacitylens/shared/brand'
import { Button } from './ui/button'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from './ui/sidebar'

// Refuse files past this size before reading them into memory (self-DoS guard).
const MAX_IMPORT_BYTES = 5 * 1024 * 1024

// Order + labels for the "what's in this file" import summary. Each `label` is a render-time
// GETTER (`() => m.key()`), not a pre-resolved string (the nav LINKS / option-getter pattern,
// P1.5.2): this list is module-scope, so resolving `m.key()` here would freeze the label to the
// load-time locale. The getter defers it to render — summarize() calls each at its call site.
const SUMMARY: [keyof AppData, () => string][] = [
  ['resources', () => m.data_summary_resources()],
  ['disciplines', () => m.data_summary_disciplines()],
  ['clients', () => m.data_summary_clients()],
  ['projects', () => m.data_summary_projects()],
  ['phases', () => m.data_summary_phases()],
  ['activities', () => m.data_summary_activities()],
  ['allocations', () => m.data_summary_allocations()],
  ['timeOff', () => m.data_summary_timeoff()],
]

function summarize(data: AppData): string {
  const parts = SUMMARY.filter(([k]) => data[k].length > 0).map(([k, label]) => `${data[k].length} ${label()}`)
  return parts.length ? parts.join(', ') : m.data_summary_none()
}

export function ImportExport() {
  // Export only the active account's data (the `accounts` list itself is omitted,
  // since import re-stamps everything into whichever account is active).
  // DELIBERATELY the RAW useScopedData, NOT useActiveScopedData (P2.4): the export must NOT apply the
  // view-only active filter — it serializes whatever the store actually holds. In the DEMO build the store
  // is the whole device blob, so archived + soft-deleted rows ARE retained in the backup. In SERVER
  // mode the store is hydrated from the active-only per-account read (readSlice `includeInactive:false`,
  // P2.4), so those rows are not present client-side — they remain in the server DB and belong to the
  // COMPLETE per-tenant export (P2.6) / the P2.5 admin "Archived & deleted" view, not this client-side
  // snapshot. Using the raw hook keeps this export decoupled from the view-hiding rule (and complete in
  // the demo build); the normal VIEWS use the active-only projection, this export does not.
  const data = useScopedData()
  const importData = useStore((s) => s.importData)
  const setNotice = useStore((s) => s.setNotice)
  const fileRef = useRef<HTMLInputElement>(null)
  const role = useRole()
  const serverMode = isServerConfigured()
  const activeAccountId = useStore((s) => s.activeAccountId)
  // Import is owner-only in server mode, mirroring the server's own POST /api/import gate: a slice
  // REPLACEMENT is destructive and id-remapping bypasses field-level write pins. In particular, an
  // admin's valid redacted export has no private codeName/real-name fields and must never be accepted
  // as a replacement that destroys those owner-confidential identities.
  // `role === null` stays importable — that is the OFF/demo/no-provider regression guard
  // (see permissionContext.ts); the server 403 remains the authoritative backstop either way.
  const canImport = !serverMode || role === null || canSeePrivateNames(role)
  // A parsed-but-not-yet-applied import, awaiting the user's confirmation. Import
  // is a full replace, so we never apply it silently — confirm first, and the
  // apply goes through the undoable history path so ⌘Z restores the old data.
  const [pendingImport, setPendingImport] = useState<{ data: AppData; name: string } | null>(null)
  // True while a server-mode import is in flight (POST + re-hydrate). Drives the blocking
  // "Importing…" dialog below — the UI LOCK that makes the import window mutation-free: no edit
  // can be made (so none can be parked, lost to a tab close, or misattributed to another
  // company), no lifecycle action can fire an out-of-band POST the import would silently
  // overwrite, and no company switch can interleave. The write-suspension seam inside
  // confirmServerImport stays as defence-in-depth for anything that slips past the lock.
  const [importBusy, setImportBusy] = useState(false)
  const setDirtyForm = useStore((s) => s.setDirtyForm)
  // While the lock is up, borrow the dirty-form semantics: AppShell's beforeunload guard prompts
  // before a tab close mid-import (a parked edit has no durable fallback in server mode, and the
  // import outcome itself deserves the warning), and the palette / undo / scheduler keyboard
  // paths — which bypass the pointer-blocking dialog — are suppressed by their existing dirtyForm
  // checks. This PARENT effect runs after the Modal child's own mount effect (which publishes
  // dirtyForm=false for its untouched form state), so the lock's `true` wins for the window.
  useEffect(() => {
    if (!importBusy) return
    setDirtyForm(true)
    return () => setDirtyForm(false)
  }, [importBusy, setDirtyForm])

  const onExport = async () => {
    // downloadTextFile throws if the download couldn't start — surface it rather than letting it
    // escape as an uncaught handler error, so the user knows the export did NOT save.
    try {
      let exported = data
      if (serverMode) {
        if (!activeAccountId) throw new Error('Choose a company before exporting.')
        // Admin/OFF-mode callers receive the structurally validated complete slice. Editors and
        // viewers retain their previously available active, already-redacted store export instead
        // of being sent to the purge-gated endpoint and receiving a guaranteed 403.
        if (role === null || can(role, 'purge')) exported = await fetchInactiveSlice(activeAccountId)
      }
      downloadTextFile('capacitylens-data.json', serializeData(exported))
    } catch (e) {
      setNotice(errorMessage(e), 'error')
    }
  }

  const onImport = async (file: File) => {
    // Reject an oversized file before reading it into memory (self-DoS guard).
    if (file.size > MAX_IMPORT_BYTES) {
      setNotice(m.data_err_too_large({ max: MAX_IMPORT_BYTES / (1024 * 1024) }), 'error')
      return
    }
    try {
      const parsed = parseData(await file.text())
      setPendingImport({ data: parsed, name: file.name })
    } catch (e) {
      // parseData throws PRECISE, user-ready messages ("This file isn't valid JSON.", "This file is
      // damaged: a data table is not a list.", "This file has too many records (…)", "This file
      // contains no CapacityLens records.") — surface the REAL reason instead of a generic catch-all, so
      // the user (and a contributor) knows why the file was rejected.
      setNotice(errorMessage(e) || m.data_err_invalid_json({ app: APP_NAME }), 'error')
    }
  }

  // SERVER-mode import goes through the ATOMIC, owner-gated POST /api/import — one server-side
  // transaction that replaces the slice via the same remap+validate the store runs — NOT through
  // the local store + batch sync. Replaying a slice replacement as /api/batch diff ops would
  // (a) run at editor tier, bypassing the server's owner-only import policy, and (b) chunk a
  // large import into multiple transactions, where a mid-sequence 409 commits a silent PARTIAL
  // import. The store is then re-hydrated from the server (refreshActiveAccountSlice), so what
  // the user sees is exactly what the server committed. The trade, stated in the dialog copy:
  // a server import is NOT undoable with ⌘Z (the store history never sees it).
  const confirmServerImport = async (incoming: AppData) => {
    // Same cross-file invariant as the demo arm below: ImportExport renders behind AppShell's
    // tenant gate, so an account is always active here.
    const accountId = useStore.getState().activeAccountId
    if (accountId === null) throw new Error('Import requires an active company.')
    setImportBusy(true)
    let keepBlockedUntilReload = false
    try {
      // Land any still-debounced pre-import edit against the PRE-import state FIRST — otherwise
      // the post-import reload's own entry flush would diff that edit against the pre-import
      // snapshot and upsert stale pre-import rows into the freshly imported slice. Refuse to
      // import while a write is still FAILED: this flow's precondition is "local edits are
      // persisted or knowingly abandoned", and a failed save's retry would later replay a stale
      // diff over the imported slice.
      if (!(await flushPendingWrites())) {
        setNotice(m.data_import_blocked_unsynced(), 'error')
        return
      }
      // SUSPEND store writes across the POST + re-hydrate: the flush above only proves
      // cleanliness at one INSTANT — an edit made while the POST is pending would otherwise
      // either land just before the import (and be silently wiped by it) or sit debounced until
      // the post-import reload pushed its stale pre-import rows into the freshly imported slice
      // (the import remaps ids, so they'd insert cleanly — no 409 stops them). A successful reload
      // rebases only the operations made during this window onto the imported slice; resume (the
      // finally below) handles the edge cases via `committed`: an import that FAILED never
      // replaced the slice, so the parked edit re-schedules; an import that COMMITTED but whose
      // re-hydrate failed/was skipped left the diff snapshot stale, so the parked edit is dropped
      // + surfaced instead — saving it would upsert ghost pre-import rows into the new slice.
      const resumeWrites = suspendServerWrites()
      let committed = false
      let safeToResume = true
      try {
        const res = await apiFetch(
          `${API_BASE}/api/import`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ accountId, data: incoming }),
          },
          // The atomic slice replacement is a BULK op like /api/state and /api/batch — give it the
          // 120s bound so a large-but-valid import isn't aborted at the 15s interactive deadline
          // into the "timed out, result unverified" branch even though it committed server-side.
          API_BULK_TIMEOUT_MS,
        )
        if (!res.ok) {
          // Prefer the server's user-facing sentence (e.g. the purge-gate 403 or a parseData 400).
          setNotice((await readApiError(res)) ?? m.data_import_failed({ status: res.status }), 'error')
          return
        }
        // A 200 means the server committed the atomic slice replacement — everything after this
        // point must treat the LOCAL state (including any parked edit) as pre-import and stale.
        committed = true
        // UNTRUSTED body: validate the two counts rather than trusting an `as` cast — and demand
        // NONNEGATIVE SAFE INTEGERS, not merely `number`, so {imported:-1}, {imported:1.5} or NaN
        // can't produce a nonsensical success notice. A 200 whose body doesn't parse or whose
        // `imported` is off-spec is a SHAPE error on a COMMITTED import — it must not be reported
        // as "no records imported" (that would skip the re-hydrate and leave the UI showing
        // pre-import data the server no longer holds). Distinguish it: null count → still
        // re-hydrate, report success without numbers, leave a breadcrumb.
        const count = (v: unknown): number | null =>
          typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null
        const body: unknown = await res.json().catch(() => null)
        const rec = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
        const imported = count(rec.imported)
        const skipped = count(rec.skipped) ?? 0
        // The success notice claims the view shows the imported data, so it must be GATED on the
        // reload actually happening: 'failed' AND 'skipped' both mean the store still renders the
        // PRE-import slice (the import itself committed — say both halves honestly; 'skipped'
        // covers a supersession or a mid-import tenant switch, where the conservative stale-view
        // notice still tells the truth). 'unattached' is unreachable behind AppShell's gate in
        // server mode (bootstrap attached the orchestrator before any tenant rendered) — it is
        // what orchestrator-less unit tests exercise.
        const viewIsStale = (outcome: Awaited<ReturnType<typeof refreshActiveAccountSlice>>) =>
          outcome === 'failed' || outcome === 'skipped'
        // NOTICE PRECEDENCE: the app holds ONE notice and a new one dismisses the old. If the
        // re-hydrate itself raised an error notice — the sticky parked-edit loss warning
        // (unreachable behind the UI lock; the suspension seam is defence-in-depth) — our
        // follow-up import notice must NOT overwrite it: a data-loss warning outranks an import
        // outcome the user can verify from the data on screen.
        const refreshRespectingNotices = async () => {
          const noticeBefore = useStore.getState().notice
          const outcome = await refreshActiveAccountSlice(accountId)
          const noticeAfter = useStore.getState().notice
          return { outcome, errorRaised: noticeAfter !== noticeBefore && noticeAfter?.tone === 'error' }
        }
        if (imported === null) {
          console.warn('import: 200 response with an off-spec body; the slice was replaced server-side', body)
          const { outcome, errorRaised } = await refreshRespectingNotices()
          if (errorRaised) return // keep the loss warning — see refreshRespectingNotices
          if (viewIsStale(outcome)) setNotice(m.data_import_refresh_failed(), 'error')
          else setNotice(m.data_import_done())
          return
        }
        // The server refuses a zero-record import (never wipes a slice with nothing) — mirror the
        // demo arm's honest failure report. Only a VALIDLY-reported zero takes this branch.
        // The refusal also UN-commits: this 200 replaced NOTHING (the server's replace is gated on
        // imported > 0), so a parked edit must take resume's re-schedule arm — dropping it here
        // would destroy a perfectly saveable edit over a replacement that never happened.
        if (imported === 0) {
          committed = false
          const why = skipped > 0 ? (skipped === 1 ? m.data_why_skipped_one({ count: skipped }) : m.data_why_skipped_other({ count: skipped })) : ''
          setNotice(m.data_no_records({ why }), 'error')
          return
        }
        // Re-hydrate the store from the server through the persistence orchestrator (token-guarded,
        // re-seeds the diff snapshot) so the UI shows exactly the committed slice. refreshActive
        // surfaces its own load failure via the persist banner; the honest stale-view notice here
        // replaces the success message when that happens.
        const { outcome, errorRaised } = await refreshRespectingNotices()
        if (errorRaised) return // keep the loss warning — see refreshRespectingNotices
        if (viewIsStale(outcome)) {
          setNotice(m.data_import_refresh_failed(), 'error')
          return
        }
        const skippedNote = skipped > 0 ? (skipped === 1 ? m.data_skipped_note_one({ count: skipped }) : m.data_skipped_note_other({ count: skipped })) : ''
        setNotice(imported === 1 ? m.data_imported_server_one({ count: imported, skipped: skippedNote }) : m.data_imported_server_other({ count: imported, skipped: skippedNote }))
      } catch {
        // Any post-dispatch transport rejection says only that the browser stopped waiting; the atomic import may
        // already have committed. Treat the outcome as unknown, never resume against the stale
        // pre-import snapshot, and reconcile from the authoritative slice first.
        committed = true
        const outcome = await refreshActiveAccountSlice(accountId)
        if (outcome === 'failed' || outcome === 'skipped' || outcome === 'unattached') {
          safeToResume = false // leave persistence suspended until a reload performs a clean boot read
          keepBlockedUntilReload = true
          setNotice(
            'The import result could not be verified. Reload this page before making changes.',
            'error',
          )
        } else {
          setNotice(
            'The import outcome was unknown, so the latest server data was reloaded. Check the imported records before continuing.',
            'warning',
          )
        }
      } finally {
        if (safeToResume) resumeWrites({ dropParkedEdits: committed })
      }
    } catch (e) {
      // A rejected fetch (server down / network error) — the import did NOT happen; say so.
      setNotice(errorMessage(e) || m.data_import_failed({ status: 0 }), 'error')
    } finally {
      if (!keepBlockedUntilReload) setImportBusy(false)
    }
  }

  const confirmImport = () => {
    if (!pendingImport) return
    if (serverMode) {
      const incoming = pendingImport.data
      setPendingImport(null)
      void confirmServerImport(incoming)
      return
    }
    const incoming = pendingImport.data
    setPendingImport(null)
    let imported: number
    let skipped: number
    try {
      ;({ imported, skipped } = importData(incoming))
    } catch (e) {
      setNotice(errorMessage(e) || m.data_import_failed({ status: 0 }), 'error')
      return
    }
    // When EVERY record was dropped (imported === 0) the store no-ops — it pushes NO undo
    // entry — so we must NOT tell the user to press ⌘Z (that would revert their PREVIOUS,
    // unrelated edit). Report the failure instead.
    if (imported === 0) {
      const why = skipped > 0 ? (skipped === 1 ? m.data_why_skipped_one({ count: skipped }) : m.data_why_skipped_other({ count: skipped })) : ''
      setNotice(m.data_no_records({ why }), 'error')
      return
    }
    // Report the delta honestly: the store drops allocations/time-off with broken
    // ranges or dangling refs, so "imported 40" can become 31 in the store.
    const skippedNote = skipped > 0 ? (skipped === 1 ? m.data_skipped_note_one({ count: skipped }) : m.data_skipped_note_other({ count: skipped })) : ''
    setNotice(imported === 1 ? m.data_imported_one({ count: imported, skipped: skippedNote }) : m.data_imported_other({ count: imported, skipped: skippedNote }))
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden" data-testid="sidebar-data-tools">
      <SidebarGroupLabel>{m.data_menu_label()}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {/* Disabled while a server import is in flight: an export mid-replacement would snapshot a
              slice that is about to be obsolete, and a second import would race the first. */}
          <SidebarMenuItem>
            <Button
              variant="ghost"
              data-testid="export-data"
              onClick={() => void onExport()}
              disabled={importBusy}
              className="h-8 w-full justify-start px-2"
            >
              {m.data_export()}
            </Button>
          </SidebarMenuItem>
          {canImport && (
            <SidebarMenuItem>
              <Button
                variant="ghost"
                data-testid="import-data"
                onClick={() => fileRef.current?.click()}
                disabled={importBusy}
                className="h-8 w-full justify-start px-2"
              >
                {m.data_import()}
              </Button>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
        {canImport && (
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            data-testid="import-input"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImport(f)
              e.target.value = ''
            }}
          />
        )}

      {/* The import UI LOCK (see importBusy above): a non-dismissable blocking dialog for the few
          seconds of POST + re-hydrate. onClose is a deliberate no-op — visibility is owned by
          importBusy alone, so Escape/backdrop cannot dismiss it. The body carries tabIndex={0} so
          the Modal's Tab-trap engages (it no-ops on a panel with zero focusables) and initial
          focus lands on the status text for screen readers. */}
      {importBusy && (
        <Modal title={m.data_importing_title()} onClose={() => {}} guardDirty={false}>
          <p tabIndex={0} data-testid="import-busy" className="text-sm text-muted-foreground">
            {m.data_importing_body()}
          </p>
        </Modal>
      )}

      {pendingImport && canImport && (
        <ConfirmDialog
          title={m.data_import_confirm_title()}
          confirmLabel={m.data_import_confirm_action()}
          message={
            <>
              {m.data_import_confirm_intro()}<span className="font-medium text-ink">{pendingImport.name}</span>{m.data_import_confirm_mid1()}<span className="font-medium text-ink">{m.data_import_confirm_replaces()}</span>{m.data_import_confirm_mid2()}{summarize(pendingImport.data)}
              {/* Honest dialog semantics: the demo/local import goes through the undoable store
                  history (⌘Z restores); the server import is an atomic server-side slice replace
                  the store history never sees, so promising ⌘Z there would be a lie. */}
              {serverMode ? m.data_import_confirm_outro_server() : m.data_import_confirm_outro()}
            </>
          }
          onConfirm={confirmImport}
          onCancel={() => setPendingImport(null)}
        />
      )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
