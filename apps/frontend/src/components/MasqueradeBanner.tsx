import { useEffect } from 'react';
import type { useNavigate } from 'react-router-dom';
import type { buildMasqueradeBannerContent } from './masqueradeBannerContent';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { m } from '@/i18n';
import {
  endMasquerade,
  reconcileMasqueradeStatus,
  retryMasqueradeProjection,
} from '@/auth/accountTransition';

const masqueradeButtonClassName =
  'border-white/70 bg-transparent text-white hover:bg-white/15 hover:text-white';

/** Names the member being viewed, its expiry, and the controls to retry or end the view. */
export function MasqueradeBanner({
  banner,
  navigate,
}: {
  banner: Exclude<ReturnType<typeof buildMasqueradeBannerContent>, null>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  useEffect(() => {
    const deadline = banner.deadline;
    if (!deadline) return;
    let timer: number | undefined;
    const checkDeadline = () => {
      const remaining = Date.parse(deadline) - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(checkDeadline, Math.min(remaining, 2_147_483_647));
        return;
      }
      void reconcileMasqueradeStatus().catch((error) => {
        console.warn('Masquerade expiry status could not be refreshed', error);
      });
    };
    checkDeadline();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [banner.deadline]);

  return (
    <Alert
      role="status"
      data-testid="masquerade-banner"
      className="rounded-none border-x-0 border-t-0 border-danger bg-danger text-white *:data-[slot=alert-description]:text-white"
    >
      <AlertDescription className="flex w-full grid-cols-none flex-row items-center justify-between gap-3">
        <span>
          {banner.label}
          {banner.deadline && (
            <span className="ml-2 font-normal">
              {m.app_masquerade_expires({
                time: new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(
                  new Date(banner.deadline),
                ),
              })}
            </span>
          )}
        </span>
        {banner.showControls && (
          <span className="flex gap-2">
            {banner.showRetryProjection && (
              <Button
                size="sm"
                variant="outline"
                className={masqueradeButtonClassName}
                onClick={() => void retryMasqueradeProjection()}
              >
                {m.app_masquerade_retry()}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className={masqueradeButtonClassName}
              onClick={() => void endMasquerade('explicit', (to) => void navigate(to))}
            >
              {banner.endLabel}
            </Button>
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
