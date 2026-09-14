import { useRef, useState } from "react";
import {
  dismissProductOrientation,
  hasDismissedProductOrientation,
  NO_ACTIVE_COMPANY_SEGMENT,
  resolveProductOrientationSubject,
} from "../lib/productOrientation";

export function useProductOrientation(input: { userId: string | null; demo: boolean; accountId: string | null }) {
  const subjectId = resolveProductOrientationSubject(input);
  const accountId = input.accountId ?? NO_ACTIVE_COMPANY_SEGMENT;
  const scope = `${subjectId}\u0000${accountId}`;
  const [visibilityOverrides, setVisibilityOverrides] = useState<Record<string, boolean>>({});
  const triggerRef = useRef<{ scope: string; element: HTMLButtonElement } | null>(null);
  const visible = visibilityOverrides[scope] ?? !hasDismissedProductOrientation(subjectId, accountId);

  const show = (trigger: HTMLButtonElement) => {
    triggerRef.current = { scope, element: trigger };
    setVisibilityOverrides((current) => ({ ...current, [scope]: true }));
  };
  const dismiss = () => {
    dismissProductOrientation(subjectId, accountId);
    setVisibilityOverrides((current) => ({ ...current, [scope]: false }));
    const trigger = triggerRef.current?.scope === scope ? triggerRef.current.element : null;
    triggerRef.current = null;
    trigger?.focus();
  };

  return { dismiss, scope, show, visible };
}
