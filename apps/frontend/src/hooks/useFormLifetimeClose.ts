import { useCallback, useLayoutEffect, useRef } from "react";

/** Keep a completed save from closing a different opening of the same editor. */
export function useFormLifetimeClose(close: () => void): () => void {
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return useCallback(() => {
    if (!active.current) return;
    active.current = false;
    close();
  }, [close]);
}
