import { AUDIT_WARNING_HEADER } from '@/lib/auditWarning';
import { m } from '@/i18n';
import { useState } from 'react';
import { useCan } from '@/auth/permissionContext';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { companyDataRequests } from '@/data/companyDataRequests';
import { runSuspendedReplacement } from '@/store/suspendedReplacement';
import type { SuspendedReplacementOutcome } from '@/store/suspendedReplacement';
import { useScopedData } from '@/store/useScopedData';
import { useStore } from '@/store/useStore';
import type { SetNotice } from '@/store/types';
import { Button } from '@/components/ui/button';
import { SettingsSection } from './SettingsSection';
import { CompanyAnonymiseSection } from './CompanyAnonymiseSection';

// Ignore the infrastructure Internal client when deciding whether the company has user-created content.
function useCompanyIsEmpty(): boolean {
  const data = useScopedData();
  return (
    data.resources.length === 0 &&
    data.clients.every((client) => client.builtin === true) &&
    data.projects.length === 0 &&
    data.allocations.length === 0
  );
}

function reportExampleData(outcome: SuspendedReplacementOutcome, setNotice: SetNotice): void {
  switch (outcome.kind) {
    case 'blocked':
      setNotice(m.settings_example_data_blocked(), 'error');
      return;
    case 'departed':
      return;
    case 'refused':
      setNotice(
        outcome.message ?? m.settings_example_data_failed({ status: outcome.status }),
        'error',
      );
      return;
    case 'uncertain': {
      const { failure } = outcome;
      const message =
        failure.kind === 'status'
          ? (failure.message ?? m.settings_example_data_failed({ status: failure.status }))
          : resolveErrorMessage(failure.cause);
      setNotice(
        outcome.reloadRequired
          ? `${message} ${m.settings_example_data_unknown_reload_required()}`
          : message,
        'error',
      );
      return;
    }
    case 'committed': {
      if (outcome.reloadRequired) {
        setNotice(m.settings_example_data_reload(), 'warning');
        return;
      }
      const degradedAudit = outcome.response.headers.get(AUDIT_WARNING_HEADER) === 'true';
      setNotice(
        degradedAudit
          ? `${m.settings_example_data_added()} ${m.app_audit_log_warning()}`
          : m.settings_example_data_added(),
        degradedAudit ? 'warning' : 'info',
      );
      return;
    }
  }
}

function ExampleDataSection() {
  const accountId = useStore((state) => state.activeAccountId);
  const setNotice = useStore((state) => state.setNotice);
  const [busy, setBusy] = useState(false);
  const addExampleData = async () => {
    if (accountId === null || busy) return;
    setBusy(true);
    try {
      const outcome = await runSuspendedReplacement({
        send: () => companyDataRequests.addExampleData(accountId),
        recovery: 'refresh',
      });
      reportExampleData(outcome, setNotice);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection
      title={m.settings_example_data_heading()}
      help={m.settings_example_data_help()}
      testId="settings-example-data"
    >
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          data-testid="add-example-data"
          onClick={() => void addExampleData()}
        >
          {m.settings_example_data_button()}
        </Button>
      </div>
    </SettingsSection>
  );
}

/** Exposes export, import, and local data controls allowed by the current mode. */
export function SettingsDataSection() {
  const canAddExampleData = useCan('members:manage');
  const companyIsEmpty = useCompanyIsEmpty();
  return (
    <>
      {canAddExampleData && companyIsEmpty && <ExampleDataSection />}
      <CompanyAnonymiseSection />
    </>
  );
}
