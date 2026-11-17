import { useEffect } from 'react';
import { toast } from 'sonner';
import { m } from '@/i18n';
import { AUDIT_WARNING_EVENT } from '@/lib/auditWarning';
import { useStore } from '@/store/useStore';
import type { StoreState } from '@/store/types';

// Store notices and audit-degradation events shown as toasts.

function showNoticeToast(notice: NonNullable<StoreState['notice']>, clear: () => void) {
  if (notice.tone === 'error') {
    return toast.error(notice.message, { duration: Infinity, onDismiss: clear });
  }
  if (notice.tone === 'warning') {
    return toast(notice.message, { duration: Infinity, onDismiss: clear });
  }
  return toast(notice.message, { duration: 4000, onDismiss: clear, onAutoClose: clear });
}

/** Shows the store notice as a toast and clears it when the toast is dismissed. */
export function useNoticeBridge(notice: StoreState['notice'], setNotice: StoreState['setNotice']) {
  useEffect(() => {
    if (!notice) return;
    const currentNotice = notice;
    const clear = () => {
      if (useStore.getState().notice === currentNotice) setNotice(null);
    };
    const id = showNoticeToast(currentNotice, clear);
    return () => {
      toast.dismiss(id);
    };
  }, [notice, setNotice]);
}

/** Shows a warning notice when a response reports degraded audit logging. */
export function useAuditWarning(setNotice: StoreState['setNotice']) {
  useEffect(() => {
    const warn = () => setNotice(m.app_audit_log_warning(), 'warning');
    globalThis.addEventListener(AUDIT_WARNING_EVENT, warn);
    return () => globalThis.removeEventListener(AUDIT_WARNING_EVENT, warn);
  }, [setNotice]);
}
