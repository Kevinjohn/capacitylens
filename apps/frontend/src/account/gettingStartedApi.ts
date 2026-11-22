import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';
import { readApiData } from '@/api/readApiData';
import { fetchApi } from '@/data/requestTimeout';
import { isRecord } from '@capacitylens/shared/lib/isRecord';
import type { GettingStartedSteps } from '@capacitylens/shared/domain/gettingStarted';

/** Company-scoped getting-started dismissal. Each call throws an `Error` when the server refuses it. */
export const gettingStartedApi = {
  /**
   * Reads whether the company dismissed getting started and which milestones it has reached.
   *
   * @throws An `Error` for a refused request or an off-spec body.
   */
  async read(
    companyId: string,
    signal?: AbortSignal,
  ): Promise<{ dismissed: boolean; steps: GettingStartedSteps }> {
    const response = await fetchApi(
      buildApiRouteUrl('api.getting-started.show', { params: { companyId } }),
      {
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
    if (!response.ok) throw new Error(`Getting started read failed (${response.status})`);
    const result: unknown = await readApiData(response);
    if (!isRecord(result) || typeof result.dismissed !== 'boolean') {
      throw new Error('Getting started response was invalid');
    }
    if (!isRecord(result.steps)) throw new Error('Getting started response was invalid');
    const { person, client, project, activity, scheduled } = result.steps;
    if (
      typeof person !== 'boolean' ||
      typeof client !== 'boolean' ||
      typeof project !== 'boolean' ||
      typeof activity !== 'boolean' ||
      typeof scheduled !== 'boolean'
    ) {
      throw new Error('Getting started response was invalid');
    }
    const steps: GettingStartedSteps = { person, client, project, activity, scheduled };
    return { dismissed: result.dismissed, steps };
  },

  /**
   * Records that the company dismissed getting started.
   *
   * @throws An `Error` when the server refuses the change.
   */
  async dismiss(companyId: string): Promise<void> {
    const response = await fetchApi(
      buildApiRouteUrl('api.getting-started.update', { params: { companyId } }),
      {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: buildJsonBody('api.getting-started.update', { dismissed: true }),
      },
    );
    if (!response.ok) throw new Error(`Getting started dismissal failed (${response.status})`);
  },
};
