import { useRef, useState } from 'react';
import {
  dismissProductOrientation,
  hasDismissedProductOrientation,
  NO_ACTIVE_COMPANY_SEGMENT,
  resolveProductOrientationSubject,
} from '@/lib/productOrientation';

/** Tracks which product orientation prompts remain relevant to the current user and account. */
export function useProductOrientation(input: { userId: string | null; companyId: string | null }) {
  const subjectId = resolveProductOrientationSubject(input);
  const companyId = input.companyId ?? NO_ACTIVE_COMPANY_SEGMENT;
  const scope = `${subjectId}\u0000${companyId}`;
  const [visibilityOverrides, setVisibilityOverrides] = useState<Record<string, boolean>>({});
  const [focusRequest, setFocusRequest] = useState({ sequence: 0, delayMs: 0 });
  const triggerRef = useRef<{ scope: string; element: HTMLButtonElement } | null>(null);
  const visible =
    visibilityOverrides[scope] ?? !hasDismissedProductOrientation(subjectId, companyId);

  const show = (trigger: HTMLButtonElement, delayMs = 0) => {
    triggerRef.current = { scope, element: trigger };
    setVisibilityOverrides((current) => ({ ...current, [scope]: true }));
    setFocusRequest((current) => ({ sequence: current.sequence + 1, delayMs }));
  };
  const dismiss = () => {
    dismissProductOrientation(subjectId, companyId);
    setVisibilityOverrides((current) => ({ ...current, [scope]: false }));
    const trigger = triggerRef.current?.scope === scope ? triggerRef.current.element : null;
    triggerRef.current = null;
    trigger?.focus();
  };

  return { dismiss, focusRequest, scope, show, visible };
}
