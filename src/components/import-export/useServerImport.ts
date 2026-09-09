import { useEffect, useRef, useState } from "react";
import type { AppData } from "@capacitylens/shared/types/entities";
import { API_BASE } from "../../data/apiConfig";
import {
  flushPendingWrites,
  refreshActiveAccountSlice,
  suspendServerWrites,
  type RefreshOutcome,
} from "../../data/persist";
import { apiFetch, API_BULK_TIMEOUT_MS } from "../../data/requestTimeout";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { readApiError } from "../../lib/readApiError";
import { useStore } from "../../store/useStore";
import { m } from "@/i18n";

type SetNotice = ReturnType<typeof useStore.getState>["setNotice"];
type ImportTransaction = { committed: boolean; requiresReload: boolean };
type ImportContext = {
  accountId: string;
  transaction: ImportTransaction;
  setRequiresReload: (required: boolean) => void;
  setNotice: SetNotice;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const parseCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const isStaleView = (outcome: RefreshOutcome): boolean =>
  outcome.kind === "failed" || outcome.kind === "skipped" || outcome.kind === "unattached";

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

const requireAuthoritativeReload = (context: ImportContext, message: string): void => {
  context.transaction.requiresReload = true;
  context.setRequiresReload(true);
  context.setNotice(message, "error");
};

const refreshRespectingNotices = async (accountId: string) => {
  const noticeBefore = useStore.getState().notice;
  const outcome = await refreshActiveAccountSlice(accountId);
  const noticeAfter = useStore.getState().notice;
  return { outcome, errorRaised: noticeAfter !== noticeBefore && noticeAfter?.tone === "error" };
};

const reconcileUnknownOutcome = async (context: ImportContext): Promise<void> => {
  context.transaction.committed = true;
  const outcome = await refreshActiveAccountSlice(context.accountId).catch((): RefreshOutcome => ({ kind: "failed" }));
  if (isStaleView(outcome)) {
    requireAuthoritativeReload(context, m.data_import_unknown_reload_required());
    return;
  }
  context.setNotice(m.data_import_unknown_reloaded(), "warning");
};

const reportCommittedImport = async (context: ImportContext, successMessage: string): Promise<void> => {
  const { outcome, errorRaised } = await refreshRespectingNotices(context.accountId);
  if (isStaleView(outcome)) {
    requireAuthoritativeReload(context, m.data_import_refresh_failed());
    return;
  }
  if (!errorRaised) context.setNotice(successMessage);
};

const handleSuccessfulResponse = async (response: Response, context: ImportContext): Promise<void> => {
  context.transaction.committed = true;
  const body: unknown = await response.json().catch(() => null);
  const imported = parseCount(isRecord(body) ? body.imported : undefined);
  const skipped = parseCount(isRecord(body) ? body.skipped : undefined) ?? 0;
  if (imported === null) {
    console.warn("import: 200 response with an off-spec body; the slice was replaced server-side", body);
    await reportCommittedImport(context, m.data_import_done());
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

const runServerImport = async (incoming: AppData, context: ImportContext): Promise<void> => {
  const { accountId, transaction, setNotice } = context;
  if ((await flushPendingWrites()).kind === "blocked") {
    setNotice(m.data_import_blocked_unsynced(), "error");
    return;
  }
  const resumeWrites = suspendServerWrites();
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
    if (response.ok) await handleSuccessfulResponse(response, context);
    else if (response.status === 408 || response.status >= 500) await reconcileUnknownOutcome(context);
    else setNotice((await readApiError(response)) ?? m.data_import_failed({ status: response.status }), "error");
  } catch {
    await reconcileUnknownOutcome(context);
  } finally {
    if (!transaction.requiresReload) resumeWrites({ dropParkedEdits: transaction.committed });
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
    setDirtyFormSource(dirtySource, true);
    return () => setDirtyFormSource(dirtySource, false);
  }, [busy, dirtySource, setDirtyFormSource]);

  const confirm = async (incoming: AppData): Promise<void> => {
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
      await runServerImport(incoming, { accountId, transaction, setRequiresReload, setNotice });
      if (!transaction.requiresReload) setBusy(false);
    } catch (error) {
      setNotice(resolveErrorMessage(error) || m.data_import_failed({ status: 0 }), "error");
      setBusy(false);
    } finally {
      if (!transaction.requiresReload) importInFlightRef.current = false;
    }
  };

  return { confirm, busy, requiresReload };
}
