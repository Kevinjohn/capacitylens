import { apiRouteUrl } from '@/api/queryClient';
import { apiFetch } from '@/data/requestTimeout';
import { isRecord } from '@capacitylens/shared/lib/isRecord';

/** Company-scoped onboarding dismissal. Each call throws an `Error` when the server refuses it. */
export const gettingStartedClient = {
  /**
   * Reads whether the company dismissed onboarding.
   *
   * @throws An `Error` for a refused request or an off-spec body.
   */
  async readDismissed(accountId: string, signal?: AbortSignal): Promise<boolean> {
    const response = await apiFetch(
      apiRouteUrl('api.getting-started.show', { params: { accountId } }),
      {
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
    if (!response.ok) throw new Error(`Getting started read failed (${response.status})`);
    const result: unknown = await response.json();
    if (!isRecord(result) || typeof result.dismissed !== 'boolean') {
      throw new Error('Getting started response was invalid');
    }
    return result.dismissed;
  },

  /**
   * Records that the company dismissed onboarding.
   *
   * @throws An `Error` when the server refuses the change.
   */
  async dismiss(accountId: string): Promise<void> {
    const response = await apiFetch(
      apiRouteUrl('api.getting-started.update', { params: { accountId } }),
      {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      },
    );
    if (!response.ok) throw new Error(`Getting started dismissal failed (${response.status})`);
  },
};
