import { expect, vi } from "vitest";
import { attachPersistence, switchAndAwaitHydration } from "@/data/persist";
import type { PersistenceAdapter } from "@/data/PersistenceAdapter";
import { useStore } from "@/store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";

/** Builds the built-in client fixture for an account. */
export const internalClient = (accountId: string) => ({
  id: `internal:${accountId}`,
  accountId,
  name: "Internal",
  color: "#2d75da",
  builtin: true as const,
  createdAt: "t",
  updatedAt: "t",
});

/** Returns a required test callback or fails with its context. */
export function requireCallback(value: (() => void) | null, context: string): () => void {
  if (value === null) throw new Error(`Expected ${context}`);
  return value;
}

/** Creates a controllable promise signal for async persistence tests. */
export function deferredSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** Creates local persistence data for two isolated accounts. */
export function makeLocalTwoAccounts() {
  return {
    ...emptyAppData(),
    accounts: [
      { id: "a1", name: "Alpha", color: "#1", createdAt: "t", updatedAt: "t" },
      { id: "a2", name: "Beta", color: "#1", createdAt: "t", updatedAt: "t" },
    ],
  };
}

/** A recording adapter whose loadAll serves a fixed slice for the active account. */
export function recordingAdapter(slice: AppData) {
  const loadAll = vi.fn(async (): Promise<AppData> => slice);
  const saveAll = vi.fn().mockResolvedValue(undefined);
  const adapter: PersistenceAdapter = { loadAll, saveAll };
  return { adapter, loadAll, saveAll };
}

/** Builds the second account slice used in account-switch tests. */
export const a2Slice = (): AppData => ({
  ...emptyAppData(),
  accounts: [{ id: "a2", name: "Beta", color: "#1", createdAt: "t", updatedAt: "t" }],
  clients: [
    {
      id: "c2",
      accountId: "a2",
      name: "Stark Industries",
      color: "#1",
      createdAt: "t",
      updatedAt: "t",
    },
    internalClient("a2"),
  ],
});

/** Builds paired account slices for persistence switching tests. */
export const accountSwitchSlices = () => ({
  aSlice: {
    ...emptyAppData(),
    accounts: [{ id: "a1", name: "Alpha", color: "#1", createdAt: "t", updatedAt: "t" }],
    clients: [
      {
        id: "ca",
        accountId: "a1",
        name: "Wayne Enterprises",
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
        name: "Stark Industries",
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
  useStore.getState().setAccountSummaries({ list: [{ id: "a2", name: "Beta", role: "owner" }] });
  const detach = attachPersistence({
    store: useStore,
    adapter: adapter,
    debounceMs: debounceMs,
    ...(onError ? { onError } : {}),
    ...(onSuccess ? { onSuccess } : {}),
    serverMode: true,
  });
  try {
    await expect(switchAndAwaitHydration("a2")).resolves.toEqual({ kind: "reloaded" });
    return detach;
  } catch (error) {
    // Detach the test persistence owner before rethrowing setup failure so it cannot leak listeners into later tests.
    detach();
    throw error;
  }
}
