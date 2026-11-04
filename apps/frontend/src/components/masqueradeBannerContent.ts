import type { useStore } from '@/store/useStore';
import { m } from '@/i18n';

/** The banner shown while viewing as a member, or null when no member view is in progress. */
export function buildMasqueradeBannerContent(
  masquerade: ReturnType<typeof useStore.getState>['masquerade'],
) {
  switch (masquerade.kind) {
    case 'inactive':
      return null;
    case 'starting':
      return {
        label: m.app_masquerade_starting(),
        deadline: masquerade.state?.expiresAt,
        showControls: masquerade.state !== undefined,
        showRetryProjection: true,
        endLabel: m.app_masquerade_end_now(),
      };
    case 'active':
      return {
        label: m.app_masquerading_as({ name: masquerade.state.targetName }),
        deadline: masquerade.state.expiresAt,
        showControls: true,
        showRetryProjection: false,
        endLabel: m.app_masquerade_end_now(),
      };
    case 'ending':
      return {
        label: m.app_masquerade_ending(),
        deadline: masquerade.state.expiresAt,
        showControls: true,
        showRetryProjection: false,
        endLabel: m.app_masquerade_retry(),
      };
  }
}
