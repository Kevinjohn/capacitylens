import { useEffect, useRef, useState } from 'react';
import { m } from '@/i18n';
import { PasswordConfirmationDialog } from '@/auth/PasswordConfirmationDialog';
import { useCan } from '@/auth/permissionContext';
import { companyDataRequests } from '@/data/companyDataRequests';
import { runSuspendedReplacement } from '@/store/suspendedReplacement';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { reloadPage } from '@/lib/reloadPage';
import { useStore } from '@/store/useStore';
import { Modal } from '@/components/common/ui';
import { Button } from '@/components/ui/button';
import { SettingsSection } from './SettingsSection';

/** Confirms anonymising all people against the active native session. */
export function CompanyAnonymiseSection() {
  const companyId = useStore((state) => state.activeCompanyId);
  const setNotice = useStore((state) => state.setNotice);
  const allowed = useCan('company:anonymise');
  const [confirming, setConfirming] = useState(false);
  const [proving, setProving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let previous = useStore.getState().activeCompanyId;
    return useStore.subscribe((state) => {
      if (state.activeCompanyId === previous) return;
      const leavingCompany = previous !== null;
      previous = state.activeCompanyId;
      generation.current += 1;
      if (leavingCompany) {
        setProving(false);
        setConfirming(false);
        setRequiresReload(false);
      }
    });
  }, []);

  if (!allowed || !companyId) return null;

  const submit = async (confirmationId: string) => {
    if (inFlight.current || requiresReload || useStore.getState().activeCompanyId !== companyId) {
      return;
    }
    inFlight.current = true;
    const submittedGeneration = generation.current;
    const isCurrent = () =>
      generation.current === submittedGeneration &&
      useStore.getState().activeCompanyId === companyId;
    setBusy(true);
    const outcome = await runSuspendedReplacement({
      send: () => companyDataRequests.anonymiseCompanyPeople(companyId, confirmationId),
      recovery: 'reload',
    });
    if (outcome.kind === 'committed') {
      setRequiresReload(true);
      reloadPage();
      return;
    }
    if (outcome.kind === 'uncertain') {
      // A lost or failed response after dispatch may follow a commit; only a fresh load is safe.
      const { failure } = outcome;
      const message =
        failure.kind === 'status'
          ? `HTTP ${failure.status} left the operation outcome uncertain.`
          : resolveErrorMessage(failure.cause);
      if (isCurrent()) {
        setRequiresReload(true);
        setNotice(message, 'error');
      } else reloadPage();
      return;
    }
    if (isCurrent()) {
      if (outcome.kind === 'blocked') setNotice(m.data_import_blocked_unsynced(), 'error');
      if (outcome.kind === 'refused') {
        setNotice(
          outcome.message ?? m.settings_archived_err_action({ status: outcome.status }),
          'error',
        );
      }
    }
    inFlight.current = false;
    setBusy(false);
    if (isCurrent()) setConfirming(false);
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
          }}
          footer={
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirming(false);
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
                setProving(true);
              }}
            >
              {busy ? m.ownership_transfer_working() : m.settings_company_anonymise_button()}
            </Button>
          )}
        </Modal>
      )}
      {proving && (
        <PasswordConfirmationDialog
          action="anonymise"
          companyId={companyId}
          intent={{}}
          onConfirmed={(confirmationId) => {
            setProving(false);
            void submit(confirmationId);
          }}
          onCancel={() => setProving(false)}
        />
      )}
    </SettingsSection>
  );
}
