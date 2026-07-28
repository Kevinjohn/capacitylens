export interface StartupSignalController {
  requested(): NodeJS.Signals | null;
  dispose(): void;
}

/**
 * Latch termination during bootstrap without interrupting a migration or snapshot mid-operation.
 * The bootstrap owner checks `requested` only at safe storage boundaries, then closes the database.
 * A repeated signal retains the daemon shutdown contract and force-exits immediately.
 */
export function installStartupSignalHandlers(options: {
  onRequested: (signal: NodeJS.Signals) => void;
  onRepeated: (signal: NodeJS.Signals) => void;
}): StartupSignalController {
  let requestedSignal: NodeJS.Signals | null = null;
  const handle = (signal: NodeJS.Signals) => {
    if (requestedSignal !== null) {
      options.onRepeated(signal);
      return;
    }
    requestedSignal = signal;
    options.onRequested(signal);
  };
  const onSigterm = () => handle("SIGTERM");
  const onSigint = () => handle("SIGINT");

  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);

  return {
    requested: () => requestedSignal,
    dispose: () => {
      process.off("SIGTERM", onSigterm);
      process.off("SIGINT", onSigint);
    },
  };
}
