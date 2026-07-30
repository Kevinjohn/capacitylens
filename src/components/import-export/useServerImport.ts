import { useEffect, useState } from "react";
import type { AppData } from "@capacitylens/shared/types/entities";
import { API_BASE } from "../../data/apiConfig";
import { flushPendingWrites, refreshActiveAccountSlice, suspendServerWrites } from "../../data/persist";
import { apiFetch, API_BULK_TIMEOUT_MS } from "../../data/requestTimeout";
import { errorMessage } from "../../lib/errorMessage";
import { readApiError } from "../../lib/readApiError";
import { useStore } from "../../store/useStore";
import { m } from "@/i18n";

/** Owns the atomic server-import transaction, persistence suspension and recovery state. */
export function useServerImport() {
  const setNotice = useStore((state) => state.setNotice);
  const setDirtyFormSource = useStore((state) => state.setDirtyFormSource);
  const [dirtySource] = useState(() => Symbol("import-busy"));
  const [busy, setBusy] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);

  useEffect(() => {
    if (!busy) return;
    setDirtyFormSource(dirtySource, true);
    return () => setDirtyFormSource(dirtySource, false);
  }, [busy, dirtySource, setDirtyFormSource]);

  const confirm = async (incoming: AppData): Promise<void> => {
    const accountId = useStore.getState().activeAccountId;
    if (accountId === null) throw new Error("Import requires an active company.");
    setBusy(true);
    setRequiresReload(false);
    let keepBlockedUntilReload = false;
    try {
      // The replacement starts only from a fully acknowledged pre-import slice.
      if (!(await flushPendingWrites())) {
        setNotice(m.data_import_blocked_unsynced(), "error");
        return;
      }
      const resumeWrites = suspendServerWrites();
      let committed = false;
      let safeToResume = true;
      const requireAuthoritativeReload = (message: string) => {
        safeToResume = false;
        keepBlockedUntilReload = true;
        setRequiresReload(true);
        setNotice(message, "error");
      };
      const reconcileUnknownOutcome = async () => {
        committed = true;
        const outcome = await refreshActiveAccountSlice(accountId).catch(() => "failed" as const);
        if (outcome === "failed" || outcome === "skipped" || outcome === "unattached") {
          requireAuthoritativeReload(m.data_import_unknown_reload_required());
        } else {
          setNotice(m.data_import_unknown_reloaded(), "warning");
        }
      };
      try {
        const response = await apiFetch(
          `${API_BASE}/api/import`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ accountId, data: incoming }),
          },
          API_BULK_TIMEOUT_MS,
        );
        if (!response.ok) {
          if (response.status === 408 || response.status >= 500) {
            await reconcileUnknownOutcome();
            return;
          }
          setNotice((await readApiError(response)) ?? m.data_import_failed({ status: response.status }), "error");
          return;
        }

        committed = true;
        const count = (value: unknown): number | null =>
          typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
        const body: unknown = await response.json().catch(() => null);
        const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
        const imported = count(record.imported);
        const skipped = count(record.skipped) ?? 0;
        const viewIsStale = (outcome: Awaited<ReturnType<typeof refreshActiveAccountSlice>>) =>
          outcome === "failed" || outcome === "skipped" || outcome === "unattached";
        const refreshRespectingNotices = async () => {
          const noticeBefore = useStore.getState().notice;
          const outcome = await refreshActiveAccountSlice(accountId);
          const noticeAfter = useStore.getState().notice;
          return { outcome, errorRaised: noticeAfter !== noticeBefore && noticeAfter?.tone === "error" };
        };

        if (imported === null) {
          console.warn("import: 200 response with an off-spec body; the slice was replaced server-side", body);
          const { outcome, errorRaised } = await refreshRespectingNotices();
          if (viewIsStale(outcome)) {
            requireAuthoritativeReload(m.data_import_refresh_failed());
            return;
          }
          if (errorRaised) return;
          setNotice(m.data_import_done());
          return;
        }
        if (imported === 0) {
          committed = false;
          const why =
            skipped > 0
              ? skipped === 1
                ? m.data_why_skipped_one({ count: skipped })
                : m.data_why_skipped_other({ count: skipped })
              : "";
          setNotice(m.data_no_records({ why }), "error");
          return;
        }

        const { outcome, errorRaised } = await refreshRespectingNotices();
        if (viewIsStale(outcome)) {
          requireAuthoritativeReload(m.data_import_refresh_failed());
          return;
        }
        if (errorRaised) return;
        const skippedNote =
          skipped > 0
            ? skipped === 1
              ? m.data_skipped_note_one({ count: skipped })
              : m.data_skipped_note_other({ count: skipped })
            : "";
        setNotice(
          imported === 1
            ? m.data_imported_server_one({ count: imported, skipped: skippedNote })
            : m.data_imported_server_other({ count: imported, skipped: skippedNote }),
        );
      } catch {
        await reconcileUnknownOutcome();
      } finally {
        if (safeToResume) resumeWrites({ dropParkedEdits: committed });
      }
    } catch (error) {
      setNotice(errorMessage(error) || m.data_import_failed({ status: 0 }), "error");
    } finally {
      if (!keepBlockedUntilReload) setBusy(false);
    }
  };

  return { confirm, busy, requiresReload };
}
