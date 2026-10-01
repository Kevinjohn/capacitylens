import { useEffect, useState } from "react";
import { useAuth } from "@/auth/authContext";
import { isServerConfigured } from "@/data/apiConfig";
import { formatDiagnostics, readBrowserDiagnostics, readDiagnostics } from "@/data/buildInfo";
import { usePersistenceDiagnostics } from "@/data/useOfflineState";
import { accountClient } from "../../account/accountClient";

type ServerObservation = { response: unknown; observedAt: string | undefined };

/** Observes the server once, then combines that snapshot with this client's live facts. */
export function useDiagnosticsController() {
  const serverMode = isServerConfigured();
  const { authMode } = useAuth();
  const persistence = usePersistenceDiagnostics();
  const [observation, setObservation] = useState<ServerObservation>(() => ({
    response: null,
    observedAt: serverMode ? undefined : new Date().toISOString(),
  }));
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (!serverMode) return;
    const controller = new AbortController();
    void accountClient
      .diagnostics(controller.signal)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as unknown;
        setObservation({ response: body, observedAt: new Date().toISOString() });
      })
      .catch(() => {
        // An unavailable diagnostics read is itself represented in the fixed projection. The
        // caught error is intentionally not rendered or copied, because it may contain internals.
        if (!controller.signal.aborted) setObservation({ response: null, observedAt: new Date().toISOString() });
      });
    return () => controller.abort();
  }, [serverMode]);
  const report = formatDiagnostics(
    readDiagnostics(observation.response, observation.observedAt, {
      signInMode: authMode,
      persistence,
      browser: readBrowserDiagnostics(),
    }),
  );
  const copyReport = async () => {
    try {
      if (!("clipboard" in navigator) || typeof navigator.clipboard.writeText !== "function") {
        throw new Error("Clipboard unavailable.");
      }
      await navigator.clipboard.writeText(report);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  return { report, copyState, copyReport };
}
