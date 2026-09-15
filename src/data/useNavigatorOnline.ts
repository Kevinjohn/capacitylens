import { useSyncExternalStore } from "react";

const subscribe = (listener: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
};

const snapshot = (): boolean => typeof navigator === "undefined" || navigator.onLine;

/** The browser's current connectivity signal, kept separate from the opt-in offline cache state. */
export function useNavigatorOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
