import { useEffect, useRef, useState } from "react";
import type { BetaExportDocument } from "@capacitylens/shared/data/betaTransfer";
import { API_BASE } from "@/data/apiConfig";
import { apiFetch, API_BULK_TIMEOUT_MS } from "@/data/requestTimeout";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { readApiError } from "@/lib/readApiError";
import { useStore } from "@/store/useStore";
import { m } from "@/i18n";
import { isRecord } from "@capacitylens/shared/lib/isRecord";

type SetNotice = ReturnType<typeof useStore.getState>["setNotice"];
type ImportTransaction = { committed: boolean; requiresReload: boolean };
type ImportContext = {
  accountId: string;
  planningContext: ReturnType<typeof useStore.getState>["planning"]["context"];
  transaction: ImportTransaction;
  setRequiresReload: (required: boolean) => void;
  setNotice: SetNotice;
};

const ownsContext = (context: ImportContext): boolean => {
  const state = useStore.getState();
  return state.activeAccountId === context.accountId && state.planning.context === context.planningContext;
};

const parseCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const buildSkippedMessage = (
  skipped: number,
  messages: {
    one: (input: { count: number }) => string;
    other: (input: { count: number }) => string;
  },
): string => {
  if (skipped === 0) return "";
  return skipped === 1 ? messages.one({ count: skipped }) : messages.other({ count: skipped });
};

const markReloadRequired = (context: ImportContext, message: string): void => {
  context.transaction.requiresReload = true;
  context.setRequiresReload(true);
  context.setNotice(message, "error");
};

const refreshRespectingNotices = async (context: ImportContext) => {
  const noticeBefore = useStore.getState().notice;
  const outcome = ownsContext(context) && (await useStore.getState().refreshPlanning({ fresh: true }));
  const noticeAfter = useStore.getState().notice;
  return {
    outcome: outcome && ownsContext(context),
    errorRaised: noticeAfter !== noticeBefore && noticeAfter?.tone === "error",
  };
};

const reconcileUnknownOutcome = async (context: ImportContext): Promise<void> => {
  context.transaction.committed = true;
  if (!ownsContext(context)) return;
  const outcome = await useStore
    .getState()
    .refreshPlanning({ fresh: true })
    .catch(() => false);
  if (!ownsContext(context)) return;
  if (!outcome) {
    markReloadRequired(context, m.data_import_unknown_reload_required());
    return;
  }
  context.setNotice(m.data_import_unknown_reloaded(), "warning");
};

const reportCommittedImport = async (context: ImportContext, successMessage: string): Promise<void> => {
  if (!ownsContext(context)) return;
  const { outcome, errorRaised } = await refreshRespectingNotices(context);
  if (!ownsContext(context)) return;
  if (!outcome) {
    markReloadRequired(context, m.data_import_refresh_failed());
    return;
  }
  if (!errorRaised) context.setNotice(successMessage);
};

const completeImport = async (response: Response, context: ImportContext): Promise<void> => {
  context.transaction.committed = true;
  const body: unknown = await response.json().catch(() => null);
  if (!ownsContext(context)) return;
  const imported = parseCount(isRecord(body) ? body.imported : undefined);
  const skipped = parseCount(isRecord(body) ? body.skipped : undefined) ?? 0;
  if (imported === null) {
    console.warn("import: 200 response with an off-spec body; the slice was replaced server-side");
    await reportCommittedImport(context, m.data_import_done());
    return;
  }
  if (isRecord(body) && body.changed === false) {
    context.transaction.committed = false;
    context.setNotice(m.data_import_done());
    return;
  }
  if (imported === 0) {
    context.transaction.committed = false;
    const why = buildSkippedMessage(skipped, { one: m.data_why_skipped_one, other: m.data_why_skipped_other });
    context.setNotice(m.data_no_records({ why }), "error");
    return;
  }
  const skippedNote = buildSkippedMessage(skipped, { one: m.data_skipped_note_one, other: m.data_skipped_note_other });
  const successMessage =
    imported === 1
      ? m.data_imported_server_one({ count: imported, skipped: skippedNote })
      : m.data_imported_server_other({ count: imported, skipped: skippedNote });
  await reportCommittedImport(context, successMessage);
};

const runServerImport = async (
  document: BetaExportDocument,
  baseRevision: number,
  proofId: string,
  context: ImportContext,
): Promise<void> => {
  const { accountId, transaction, setNotice } = context;
  if (!useStore.getState().planningReadyForReplacement()) {
    setNotice(m.data_import_blocked_unsynced(), "error");
    return;
  }
  const resumeWrites = useStore.getState().suspendPlanningCommands();
  if (!resumeWrites) {
    setNotice(m.data_import_blocked_unsynced(), "error");
    return;
  }
  context.planningContext = useStore.getState().planning.context;
  try {
    if (!ownsContext(context)) return;
    const response = await apiFetch(
      `${API_BASE}/api/transfer/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accountId, document, baseRevision, proofId }),
      },
      API_BULK_TIMEOUT_MS,
    );
    if (!ownsContext(context)) return;
    if (response.ok) await completeImport(response, context);
    else if (response.status === 408 || response.status >= 500) await reconcileUnknownOutcome(context);
    else {
      const message = (await readApiError(response)) ?? m.data_import_failed({ status: response.status });
      if (ownsContext(context)) setNotice(message, "error");
    }
  } catch {
    // A missing import response does not prove rejection; reconcile server state before permitting another replacement.
    if (ownsContext(context)) await reconcileUnknownOutcome(context);
  } finally {
    if (!transaction.requiresReload) resumeWrites();
  }
};

/** Owns the atomic server-import transaction, persistence suspension and recovery state. */
export function useServerImport() {
  const setNotice = useStore((state) => state.setNotice);
  const setDirtyFormSource = useStore((state) => state.setDirtyFormSource);
  const [dirtySource] = useState(() => Symbol("import-busy"));
  const [busy, setBusy] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const importInFlightRef = useRef(false);

  useEffect(() => {
    if (!busy) return;
    setDirtyFormSource({ source: dirtySource, dirty: true });
    return () => setDirtyFormSource({ source: dirtySource, dirty: false });
  }, [busy, dirtySource, setDirtyFormSource]);

  const confirm = async (document: BetaExportDocument, baseRevision: number, proofId: string): Promise<void> => {
    if (importInFlightRef.current) return;
    importInFlightRef.current = true;
    const accountId = useStore.getState().activeAccountId;
    if (accountId === null) {
      importInFlightRef.current = false;
      throw new Error("Import requires an active company.");
    }
    setBusy(true);
    setRequiresReload(false);
    const transaction: ImportTransaction = { committed: false, requiresReload: false };
    try {
      await runServerImport(document, baseRevision, proofId, {
        accountId,
        planningContext: useStore.getState().planning.context,
        transaction,
        setRequiresReload,
        setNotice,
      });
      if (!transaction.requiresReload) setBusy(false);
    } catch (error) {
      // Report a failed import-start boundary and release busy state so recovery controls remain usable.
      if (useStore.getState().activeAccountId === accountId)
        setNotice(resolveErrorMessage(error) || m.data_import_failed({ status: 0 }), "error");
      setBusy(false);
    } finally {
      if (!transaction.requiresReload) importInFlightRef.current = false;
    }
  };

  return { confirm, busy, requiresReload };
}
