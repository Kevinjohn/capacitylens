import { useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import { ActionProofDialog } from "@/auth/ActionProofDialog";
import { useCan } from "@/auth/permissionContext";
import { useRole } from "@/auth/permissionContext";
import { API_BASE } from "@/data/apiConfig";
import { apiFetch, API_BULK_TIMEOUT_MS } from "@/data/requestTimeout";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { readApiError } from "@/lib/readApiError";
import { reloadPage } from "@/lib/reloadPage";
import { useStore } from "@/store/useStore";
import { obfuscateResource } from "@capacitylens/shared/domain/lifecycle";
import { Modal } from "@/components/common/ui";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "./SettingsSection";

const PENDING_PROOF_KEY = "capacitylens/company-anonymise-action-proof";

/** Confirms anonymising all people against the active native session. */
export function CompanyAnonymiseSection({ serverMode }: { serverMode: boolean }) {
  const accountId = useStore((state) => state.activeAccountId);
  const setNotice = useStore((state) => state.setNotice);
  const allowed = useCan("anonymise");
  const role = useRole();
  const [confirming, setConfirming] = useState(false);
  const [proving, setProving] = useState(false);
  const [readyProof, setReadyProof] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let previous = useStore.getState().activeAccountId;
    return useStore.subscribe((state) => {
      if (state.activeAccountId === previous) return;
      const leavingCompany = previous !== null;
      previous = state.activeAccountId;
      generation.current += 1;
      if (leavingCompany) {
        sessionStorage.removeItem(PENDING_PROOF_KEY);
        setReadyProof(null);
        setProving(false);
        setConfirming(false);
        setRequiresReload(false);
      }
    });
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(PENDING_PROOF_KEY);
    if (new URLSearchParams(window.location.search).get("capacitylensActionConfirmed") !== "1") {
      if (saved) sessionStorage.removeItem(PENDING_PROOF_KEY);
      return;
    }
    if (!saved || !accountId) return;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(PENDING_PROOF_KEY);
      const url = new URL(window.location.href);
      url.searchParams.delete("capacitylensActionConfirmed");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
      try {
        const pending: unknown = JSON.parse(saved);
        if (
          !pending ||
          typeof pending !== "object" ||
          !("accountId" in pending) ||
          pending.accountId !== accountId ||
          !("proofId" in pending) ||
          typeof pending.proofId !== "string"
        )
          throw new Error("Company confirmation could not be resumed.");
        setReadyProof(pending.proofId);
        setConfirming(true);
      } catch {
        setNotice(m.reauth_failed(), "error");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [accountId, setNotice]);

  if (!allowed || !accountId || (serverMode && role !== "owner")) return null;

  const anonymiseDemo = () => {
    const state = useStore.getState();
    if (state.activeAccountId !== accountId) return;
    const data = state.data;
    state.replaceAfterDemoImport({
      ...data,
      resources: data.resources.map((row) =>
        row.accountId === accountId ? { ...obfuscateResource(row), avatarUrl: null } : row,
      ),
      allocations: data.allocations.map((row) =>
        row.accountId === accountId && row.note != null ? { ...row, note: null } : row,
      ),
      timeOff: data.timeOff.map((row) =>
        row.accountId === accountId && row.note != null ? { ...row, note: null } : row,
      ),
    });
    setConfirming(false);
    setNotice(m.settings_company_anonymise_done());
  };

  const submit = async (proofId: string) => {
    if (inFlight.current || requiresReload || useStore.getState().activeAccountId !== accountId) return;
    inFlight.current = true;
    const submittedGeneration = generation.current;
    const stillCurrent = () =>
      generation.current === submittedGeneration && useStore.getState().activeAccountId === accountId;
    setBusy(true);
    let resumeWrites: (() => void) | null = null;
    let committed = false;
    let mustReload = false;
    let dispatched = false;
    try {
      if (!useStore.getState().planningReadyForReplacement()) {
        if (stillCurrent()) setNotice(m.data_import_blocked_unsynced(), "error");
        return;
      }
      resumeWrites = useStore.getState().suspendPlanningCommands();
      if (!resumeWrites) {
        if (stillCurrent()) setNotice(m.data_import_blocked_unsynced(), "error");
        return;
      }
      if (!stillCurrent()) return;
      dispatched = true;
      const response = await apiFetch(
        `${API_BASE}/api/accounts/${encodeURIComponent(accountId)}/anonymise`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proofId }),
        },
        API_BULK_TIMEOUT_MS,
      );
      if (response.status === 204) {
        committed = true;
        mustReload = true;
        setRequiresReload(true);
        reloadPage();
        return;
      }
      if (response.status === 408 || response.status >= 500)
        throw new Error(`HTTP ${response.status} left the operation outcome uncertain.`);
      const message = (await readApiError(response)) ?? m.settings_archived_err_action({ status: response.status });
      if (stillCurrent()) setNotice(message, "error");
    } catch (cause) {
      // A lost response after dispatch may follow a commit. Keep the old slice blocked until a fresh load.
      mustReload = dispatched;
      if (stillCurrent()) {
        if (dispatched) setRequiresReload(true);
        setNotice(resolveErrorMessage(cause), "error");
      } else if (dispatched) reloadPage();
    } finally {
      if (!mustReload && !committed) {
        resumeWrites?.();
        inFlight.current = false;
        setBusy(false);
        if (stillCurrent()) setConfirming(false);
      }
    }
  };

  return (
    <SettingsSection
      title={m.settings_company_anonymise_heading()}
      help={m.settings_company_anonymise_help()}
      testId="settings-company-anonymise"
      danger
    >
      <Button type="button" variant="danger-soft" size="sm" onClick={() => setConfirming(true)}>
        {m.settings_company_anonymise_button()}
      </Button>
      {confirming && !proving && (
        <Modal
          title={m.settings_company_anonymise_confirm_title()}
          description={m.settings_company_anonymise_confirm_body()}
          guardDirty={false}
          onClose={() => {
            if (busy) return;
            setConfirming(false);
            setReadyProof(null);
          }}
          footer={
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirming(false);
                setReadyProof(null);
              }}
              disabled={busy}
            >
              {m.form_cancel()}
            </Button>
          }
        >
          {requiresReload ? (
            <Button type="button" onClick={reloadPage}>
              {m.boundary_reload()}
            </Button>
          ) : (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (readyProof) {
                  const proofId = readyProof;
                  setReadyProof(null);
                  void submit(proofId);
                } else if (serverMode) setProving(true);
                else anonymiseDemo();
              }}
            >
              {busy ? m.ownership_transfer_working() : m.settings_company_anonymise_button()}
            </Button>
          )}
        </Modal>
      )}
      {proving && (
        <ActionProofDialog
          action="anonymise"
          accountId={accountId}
          intent={{}}
          onConfirmed={(proofId) => {
            setProving(false);
            void submit(proofId);
          }}
          onProviderStart={(proofId) =>
            sessionStorage.setItem(PENDING_PROOF_KEY, JSON.stringify({ accountId, proofId }))
          }
          onCancel={() => setProving(false)}
        />
      )}
    </SettingsSection>
  );
}
