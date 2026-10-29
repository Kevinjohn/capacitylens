import { useCallback, useEffect, useState } from 'react';
import { isAccountRole } from '@capacitylens/shared/account/types';
import { m } from '@/i18n';
import { resolveRejectionMessage, teamAccessClient } from '@/account/teamAccessClient';
import type { AdmissionRequest } from '@/account/teamAccessClient';
import { resolveRoleLabel } from '@/lib/accessCopy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Listing =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; requests: AdmissionRequest[] };

async function fetchListing(signal?: AbortSignal): Promise<Listing> {
  try {
    const result = await teamAccessClient.listAdmissionRequests(signal);
    return result.kind === 'ok' ? { kind: 'ready', requests: result.value } : { kind: 'failed' };
  } catch (failure) {
    if (!signal?.aborted) console.warn('AdmissionRequestsPanel: listing failed', failure);
    return { kind: 'failed' };
  }
}

/**
 * Lists people waiting for admission and lets an Owner or Admin approve or decline each one. Declined
 * and revoked people stay listed so a mistaken decision can be reversed.
 */
export function AdmissionRequestsPanel() {
  const [listing, setListing] = useState<Listing>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    return fetchListing(signal).then((next) => {
      if (!signal?.aborted) setListing(next);
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const decide = async (request: AdmissionRequest, decision: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      const result = await teamAccessClient.decideAdmission(request.userId, decision);
      if (result.kind !== 'ok') {
        setError(resolveRejectionMessage(result, m.settings_admission_failed()));
      }
      await load();
    } catch (failure) {
      console.warn('AdmissionRequestsPanel: decision failed', failure);
      setError(m.settings_admission_failed());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="admission-requests" aria-busy={busy || listing.kind === 'loading'}>
      <CardHeader>
        <CardTitle>
          <h2>{m.settings_admission_heading()}</h2>
        </CardTitle>
        <CardDescription>{m.settings_admission_intro()}</CardDescription>
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setListing({ kind: 'loading' });
                void load();
              }}
            >
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
                  {request.invitedRole && isAccountRole(request.invitedRole) && (
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
