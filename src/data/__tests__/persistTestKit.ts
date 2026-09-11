// Shared helpers for the persist.*.test.ts suites in src/data/.
// Extracted from the former single-file persist.test.ts; bodies unchanged.

import { vi } from "vitest";
import { attachPersistence } from "../persist";
import type { PersistenceAdapter } from "../PersistenceAdapter";
import { useStore } from "../../store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";

export const internalClient = (accountId: string) => ({
  id: `internal:${accountId}`,
  accountId,
  name: "Internal",
  color: "#2d75da",
  builtin: true as const,
  createdAt: "t",
  updatedAt: "t",
});

export function requireCallback(value: (() => void) | null, context: string): () => void {
  if (value === null) throw new Error(`Expected ${context}`);
  return value;
}

export function makeLocalTwoAccounts() {
  return {
    ...emptyAppData(),
    accounts: [
      { id: "a1", name: "Alpha", color: "#1", createdAt: "t", updatedAt: "t" },
      { id: "a2", name: "Beta", color: "#1", createdAt: "t", updatedAt: "t" },
    ],
  };
}

// ── Shared server-mode refresh helpers ────────────────────────────────────────────────────────────
// Used by the refresh-on-focus, refreshActiveAccountSlice, and batch-conflict suites (hoisted so the
// three don't carry verbatim copies).

/** A recording adapter whose loadAll serves a fixed slice for the active account. */
export function recordingAdapter(slice: AppData) {
  const loadAll = vi.fn(async (): Promise<AppData> => slice);
  const saveAll = vi.fn().mockResolvedValue(undefined);
  const adapter: PersistenceAdapter = { loadAll, saveAll };
  return { adapter, loadAll, saveAll };
}

export const a2Slice = (): AppData => ({
  ...emptyAppData(),
  accounts: [{ id: "a2", name: "Beta", color: "#1", createdAt: "t", updatedAt: "t" }],
  clients: [
    {
      id: "c2",
      accountId: "a2",
      name: "Beta Client",
      color: "#1",
      createdAt: "t",
      updatedAt: "t",
    },
    internalClient("a2"),
  ],
});

export const accountSwitchSlices = () => ({
  aSlice: {
    ...emptyAppData(),
    accounts: [{ id: "a1", name: "Alpha", color: "#1", createdAt: "t", updatedAt: "t" }],
    clients: [
      {
        id: "ca",
        accountId: "a1",
        name: "Alpha Client",
        color: "#1",
        createdAt: "t",
        updatedAt: "t",
      },
    ],
  } satisfies AppData,
  bSlice: {
    ...emptyAppData(),
    accounts: [{ id: "b1", name: "Beta", color: "#1", createdAt: "t", updatedAt: "t" }],
    clients: [
      {
        id: "cb",
        accountId: "b1",
        name: "Beta Client",
        color: "#1",
        createdAt: "t",
        updatedAt: "t",
      },
    ],
  } satisfies AppData,
});

interface AttachActiveA2Input {
  adapter: PersistenceAdapter;
  debounceMs?: number;
  onError?: (e: unknown) => void;
  onSuccess?: () => void;
}

/** Server-mode attach with a2 already the active account (post-pick steady state). */
export async function attachActiveA2({ adapter, debounceMs = 0, onError, onSuccess }: AttachActiveA2Input) {
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().setActiveAccount(null);
  useStore.getState().setAccountSummaries([{ id: "a2", name: "Beta", role: "owner" }]);
  const detach = attachPersistence({
    store: useStore,
    adapter: adapter,
    debounceMs: debounceMs,
    ...(onError ? { onError } : {}),
    ...(onSuccess ? { onSuccess } : {}),
    serverMode: true,
  });
  useStore.getState().setActiveAccount("a2"); // hydrates a2, seeds snapshot := a2
  await new Promise((r) => setTimeout(r, 5));
  return detach;
}
