import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buildScopeQueryKey } from '@/api/queryClient';
import { useQueryScope } from '@/api/useQueryScope';
import { isRole } from '@capacitylens/shared/account/types';
import { m } from '@/i18n';
import { resolveRefusalMessage, teamAccessApi } from '@/account/teamAccessApi';
import type { AdmissionRequest } from '@/account/teamAccessApi';
import { resolveRoleLabel } from '@/lib/accessCopy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

async function fetchRequests(signal: AbortSignal): Promise<AdmissionRequest[]> {
  try {
    const result = await teamAccessApi.listAdmissionRequests(signal);
    if (result.kind === 'ok') return result.value;
  } catch (failure) {
    if (!signal.aborted) console.warn('AdmissionRequestsPanel: listing failed', failure);
    throw failure;
  }
  throw new Error('The admission requests could not be listed.');
}

/**
 * Lists people waiting for admission and lets an Owner or Admin approve or decline each one. Declined
 * and revoked people stay listed so a mistaken decision can be reversed.
 */
export function AdmissionRequestsPanel() {
  const scope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = buildScopeQueryKey(scope, ['admission-requests']);
  const query = useQuery({
    queryKey,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => fetchRequests(signal),
  });
  const [busy, setBusy] = useState(false);
  // A retired panel must not surface a late decision outcome in a successor context.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const [error, setError] = useState<string | null>(null);
  const listing = query.isError
    ? ({ kind: 'failed' } as const)
    : query.data
      ? ({ kind: 'ready', requests: query.data } as const)
      : ({ kind: 'loading' } as const);

  const decide = async (request: AdmissionRequest, decision: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      const result = await teamAccessApi.decideAdmission(request.userId, decision);
      if (!live.current) return;
      if (result.kind !== 'ok') {
        setError(resolveRefusalMessage(result, m.settings_admission_failed()));
      }
      await queryClient.invalidateQueries({ queryKey, exact: true });
    } catch (failure) {
      if (!live.current) return;
      console.warn('AdmissionRequestsPanel: decision failed', failure);
      setError(m.settings_admission_failed());
    } finally {
      if (live.current) setBusy(false);
    }
  };

  return (
    <Card data-testid="admission-requests" aria-busy={busy || listing.kind === 'loading'}>
      <CardHeader>
        <CardTitle>
          <h2>{m.settings_admission_heading()}</h2>
        </CardTitle>
        {listing.kind === 'ready' && listing.requests.length > 0 && (
          <CardDescription>{m.settings_admission_intro()}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {listing.kind === 'loading' && (
          <p role="status" className="text-sm text-muted-foreground">
            {m.settings_admission_loading()}
          </p>
        )}
        {listing.kind === 'failed' && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-danger">
              {m.settings_admission_load_failed()}
            </p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {m.settings_admission_retry()}
            </Button>
          </div>
        )}
        {listing.kind === 'ready' && listing.requests.length === 0 && (
          <p className="text-sm text-muted-foreground">{m.settings_admission_empty()}</p>
        )}
        {listing.kind === 'ready' && listing.requests.length > 0 && (
          <ul className="flex flex-col divide-y rounded-md border">
            {listing.requests.map((request) => (
              <li
                key={request.userId}
                data-testid="admission-request"
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-ink">{request.email}</span>
                  {request.invitedRole && isRole(request.invitedRole) && (
                    <span className="text-xs text-muted-foreground">
                      {m.settings_admission_role({ role: resolveRoleLabel(request.invitedRole) })}
                    </span>
                  )}
                  {request.approval !== 'pending' && (
                    <span className="text-xs text-muted-foreground" data-testid="admission-decided">
                      {request.approval === 'rejected'
                        ? m.settings_admission_declined()
                        : m.settings_admission_revoked()}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    data-testid="admission-approve"
                    aria-label={m.settings_admission_approve_aria({ email: request.email })}
                    disabled={busy}
                    onClick={() => void decide(request, 'approve')}
                  >
                    {m.settings_admission_approve()}
                  </Button>
                  {request.approval === 'pending' && (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="admission-reject"
                      aria-label={m.settings_admission_reject_aria({ email: request.email })}
                      disabled={busy}
                      onClick={() => void decide(request, 'reject')}
                    >
                      {m.settings_admission_reject()}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
