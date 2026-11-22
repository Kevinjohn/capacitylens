import { resolveErrorMessage } from '@/lib/errorMessage';
import { m } from '@/i18n';
import { companyDataRequests } from '@/data/companyDataRequests';
import { runSuspendedReplacement } from './suspendedReplacement';
import type { UncertainReplacementFailure } from './suspendedReplacement';
import type { SetNotice } from './types';

// A confirmed anonymisation without its mandatory refresh must stay locked across route/component
// remounts: the same stale store slice is shared across those surfaces. Module lifetime matches the
// required recovery boundary, a full page reload boots, hydrates, and creates a fresh lock map.
const reloadRequiredByCompany = new Map<string, string>();

function describeUncertainFailure(failure: UncertainReplacementFailure): string {
  return failure.kind === 'status'
    ? `HTTP ${failure.status} did not confirm whether the lifecycle mutation committed.`
    : resolveErrorMessage(failure.cause);
}

/**
 * Anonymises one person resource as a suspended whole-company replacement and shows the outcome
 * as a notice. Returns true once the page holds the server's current data.
 *
 * A committed change whose refresh failed, or an unknown outcome that could not be reconciled,
 * blocks further anonymisation in this company until the page reloads.
 */
export async function runResourceAnonymisation(
  activeCompanyId: string,
  id: string,
  setNotice: SetNotice,
): Promise<boolean> {
  const reloadRequiredMessage = reloadRequiredByCompany.get(activeCompanyId);
  if (reloadRequiredMessage) {
    setNotice(reloadRequiredMessage, 'error');
    return false;
  }
  const outcome = await runSuspendedReplacement({
    send: () => companyDataRequests.anonymiseResource(activeCompanyId, id),
    recovery: 'refresh',
  });
  switch (outcome.kind) {
    case 'blocked':
      setNotice(m.settings_anonymise_resource_blocked(), 'error');
      return false;
    case 'departed':
      return false;
    case 'refused':
      setNotice(
        outcome.message ?? m.settings_archived_err_action({ status: outcome.status }),
        'error',
      );
      return false;
    case 'committed':
      if (outcome.reloadRequired) {
        const message = m.settings_archived_committed_refresh_failed();
        reloadRequiredByCompany.set(activeCompanyId, message);
        setNotice(message, 'error');
        return false;
      }
      return true;
    case 'uncertain': {
      const cause = describeUncertainFailure(outcome.failure);
      if (outcome.reloadRequired) {
        // Keep the lock so another destructive attempt cannot race the unknown server state.
        const message = `The lifecycle request had an unknown outcome and could not be reconciled. Reload before retrying. Authoritative reload did not complete (failed). Original request: ${cause}`;
        reloadRequiredByCompany.set(activeCompanyId, message);
        setNotice(message, 'error');
        return false;
      }
      setNotice(
        `The lifecycle request had an unknown outcome, so the latest company data was reloaded. ${cause}`,
        'warning',
      );
      return true;
    }
  }
}
