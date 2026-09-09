import type {
  ClientMasqueradeEndReason,
  MasqueradeState,
  MasqueradeStatus,
} from "@capacitylens/shared/domain/masquerade";
import {
  flushPendingWrites,
  suspendServerWrites,
  switchAndAwaitHydration,
  type FlushPendingWritesResult,
  type RefreshOutcome,
} from "../data/persist";
import { setMasqueradeEndedHandler } from "../data/requestTimeout";
import { useStore } from "../store/useStore";
import { masqueradeApi } from "./masqueradeApi";
import { reprojectAccess } from "./reprojectAccess";

interface ReleaseSuspensionInput {
  dropParkedEdits: boolean;
}

interface BeginStartInput {
  generation: number;
  accountId: string;
  targetUserId: string;
  flush: FlushPendingWritesResult;
}

interface EndProjectionInput {
  reason: ClientMasqueradeEndReason;
  finish: (state: MasqueradeState) => Promise<FinishProjectionResult>;
  failureMessage: string;
  options: { onNoState: NoStatePolicy };
}

type ResumeWrites = (options?: { dropParkedEdits?: boolean }) => void;
type EndProjectionResult = { kind: "inactive" } | { kind: "superseded" } | { kind: "noop" } | { kind: "failed" };
type FinishProjectionResult = { ok: true } | { ok: false; message: string };
type NoStatePolicy = "succeed" | "wait";

function isSwitchSuccessful(outcome: RefreshOutcome, accountId: string | null): boolean {
  return outcome.kind === "reloaded" || (accountId === null && outcome.kind !== "failed");
}

export interface MasqueradeControllerDependencies {
  flush: () => Promise<FlushPendingWritesResult>;
  suspend: () => ResumeWrites;
  reproject: (accountId: string) => Promise<boolean>;
  switchAccount: (accountId: string | null) => Promise<RefreshOutcome>;
  api: typeof masqueradeApi;
}

/** Sole owner of the persistence suspension used by identity masquerade transitions. */
export class MasqueradeController {
  private readonly dependencies: MasqueradeControllerDependencies;
  private resumeWrites: ResumeWrites | null = null;
  private generation = 0;
  private startPendingGeneration: number | null = null;

  constructor(dependencies: MasqueradeControllerDependencies) {
    this.dependencies = dependencies;
  }

  private acquireSuspension(): void {
    this.resumeWrites ??= this.dependencies.suspend();
  }

  private releaseSuspension({ dropParkedEdits }: ReleaseSuspensionInput): void {
    const resume = this.resumeWrites;
    this.resumeWrites = null;
    resume?.({ dropParkedEdits });
  }

  private fail(message: string): false {
    useStore.getState().setNotice(message, "error");
    return false;
  }

  private ownsRuntime(generation: number, kind: "starting" | "active" | "ending"): boolean {
    const runtime = useStore.getState().masquerade;
    return runtime.kind === kind && runtime.generation === generation && this.generation === generation;
  }

  private beginStartAfterFlush({ generation, accountId, targetUserId, flush }: BeginStartInput): boolean {
    if (this.startPendingGeneration !== generation) return false;
    this.startPendingGeneration = null;
    if (this.generation !== generation) return false;
    if (useStore.getState().masquerade.kind !== "inactive") return false;
    if (flush.kind === "blocked") return this.fail("Save pending changes before starting a masquerade.");
    this.acquireSuspension();
    useStore.getState().setMasquerade({ kind: "starting", pending: { accountId, targetUserId }, generation });
    return true;
  }

  private failOwnedStart(generation: number, error: unknown): false {
    if (!this.ownsRuntime(generation, "starting")) return false;
    this.releaseSuspension({ dropParkedEdits: false });
    useStore.getState().setMasquerade({ kind: "inactive" });
    return this.fail(error instanceof Error ? error.message : "Masquerade could not be started.");
  }

  private async finishStartProjection(generation: number, accountId: string, state: MasqueradeState): Promise<boolean> {
    try {
      const projected = await this.dependencies.reproject(accountId);
      if (!this.ownsRuntime(generation, "starting")) return false;
      if (!projected) {
        return this.fail("The member view started, but its data could not be loaded. Retry or end the masquerade.");
      }
    } catch (error) {
      if (!this.ownsRuntime(generation, "starting")) return false;
      console.error("Masquerade target projection could not be loaded", error);
      return this.fail("The member view started, but its data could not be loaded. Retry or end the masquerade.");
    }
    useStore.getState().clearUndoHistory();
    useStore.getState().setMasquerade({ kind: "active", state, generation });
    return true;
  }

  async start(accountId: string, targetUserId: string): Promise<boolean> {
    if (this.startPendingGeneration !== null) return false;
    if (useStore.getState().masquerade.kind !== "inactive") {
      return this.fail("End the current masquerade before starting another.");
    }
    const generation = ++this.generation;
    this.startPendingGeneration = generation;
    let flush: FlushPendingWritesResult;
    try {
      flush = await this.dependencies.flush();
    } catch (error) {
      if (this.startPendingGeneration !== generation) return false;
      this.startPendingGeneration = null;
      if (this.generation !== generation) return false;
      return this.fail(error instanceof Error ? error.message : "Pending changes could not be saved.");
    }
    if (!this.beginStartAfterFlush({ generation, accountId, targetUserId, flush })) return false;
    let state: MasqueradeState;
    try {
      state = await this.dependencies.api.start(accountId, targetUserId);
    } catch (error) {
      return this.failOwnedStart(generation, error);
    }
    if (!this.ownsRuntime(generation, "starting")) return false;
    useStore.getState().setMasquerade({ kind: "starting", pending: { accountId, targetUserId }, state, generation });
    return this.finishStartProjection(generation, accountId, state);
  }

  async retryProjection(): Promise<boolean> {
    const runtime = useStore.getState().masquerade;
    if (runtime.kind === "inactive") return false;
    const state = runtime.state;
    if (!state) return false;
    const generation = runtime.generation;
    try {
      const projected = await this.dependencies.reproject(state.accountId);
      if (!this.ownsRuntime(generation, runtime.kind)) return false;
      if (!projected) {
        return this.fail("The member view could not be loaded.");
      }
    } catch (error) {
      if (!this.ownsRuntime(generation, runtime.kind)) return false;
      console.error("Masquerade projection retry failed", error);
      return this.fail("The member view could not be loaded.");
    }
    useStore.getState().clearUndoHistory();
    useStore.getState().setMasquerade({ kind: "active", state, generation });
    return true;
  }

  async end(reason: ClientMasqueradeEndReason = "explicit", navigate?: (to: string) => void): Promise<boolean> {
    const ended = await this.endProjection({
      reason: reason,
      finish: async (state) => {
        if (!(await this.dependencies.reproject(state.accountId))) {
          return { ok: false, message: "The real account view could not be restored. Retry ending the masquerade." };
        }
        return { ok: true };
      },
      failureMessage: "Masquerade could not be ended.",
      options: { onNoState: "succeed" },
    });
    if (ended.kind === "inactive") navigate?.("/");
    return ended.kind !== "failed";
  }

  async transitionAccount(accountId: string | null): Promise<boolean> {
    const runtime = useStore.getState().masquerade;
    if (runtime.kind === "inactive") {
      const outcome = await this.dependencies.switchAccount(accountId);
      return isSwitchSuccessful(outcome, accountId);
    }
    const ended = await this.endProjection({
      reason: "account_switch",
      finish: async () => {
        const outcome = await this.dependencies.switchAccount(accountId);
        return isSwitchSuccessful(outcome, accountId)
          ? { ok: true }
          : { ok: false, message: "The selected company could not be loaded." };
      },
      failureMessage: "The company switch could not be completed.",
      options: { onNoState: "wait" },
    });
    if (ended.kind === "superseded") {
      return this.fail("A newer masquerade is active. End it before switching companies.");
    }
    return ended.kind === "inactive";
  }

  private async endProjection({
    reason,
    finish,
    failureMessage,
    options,
  }: EndProjectionInput): Promise<EndProjectionResult> {
    const runtime = useStore.getState().masquerade;
    const state = runtime.kind === "inactive" ? null : runtime.state;
    if (!state) {
      if (options.onNoState === "succeed") return { kind: "noop" };
      this.fail("Wait for the current masquerade transition to finish.");
      return { kind: "failed" };
    }
    const generation = ++this.generation;
    this.acquireSuspension();
    useStore.getState().setMasquerade({ kind: "ending", state, generation });
    try {
      await this.dependencies.api.end(state.token, reason);
      if (!this.ownsRuntime(generation, "ending")) return { kind: "superseded" };
      const status = await this.dependencies.api.status();
      if (!this.ownsRuntime(generation, "ending")) return { kind: "superseded" };
      if (status.active) {
        useStore.getState().setMasquerade({ kind: "active", state: status, generation });
        return { kind: "superseded" };
      }
      const finishResult = await finish(state);
      if (!this.ownsRuntime(generation, "ending")) return { kind: "superseded" };
      if (!finishResult.ok) {
        this.fail(finishResult.message);
        return { kind: "failed" };
      }
      this.releaseSuspension({ dropParkedEdits: true });
      useStore.getState().clearUndoHistory();
      useStore.getState().setMasquerade({ kind: "inactive" });
      return { kind: "inactive" };
    } catch (error) {
      if (!this.ownsRuntime(generation, "ending")) return { kind: "superseded" };
      this.fail(error instanceof Error ? error.message : failureMessage);
      return { kind: "failed" };
    }
  }

  /** Adopt status before PermissionProvider publishes an effective role, preventing a writable frame. */
  adoptStatus(status: MasqueradeStatus): void {
    const current = useStore.getState().masquerade;
    if (!status.active) {
      if (current.kind === "active" || current.kind === "starting") this.restoreServerEndedProjection();
      return;
    }
    // The controller already owns these transitions. A membership invalidation triggered by its
    // own reproject must not publish `active` before that authoritative reload has completed.
    if (current.kind === "starting" || current.kind === "ending") return;
    this.acquireSuspension();
    useStore.getState().setMasquerade({ kind: "active", state: status, generation: ++this.generation });
  }

  /** A projected read reported that server-side revalidation ended this session's masquerade. */
  restoreServerEndedProjection(): void {
    const runtime = useStore.getState().masquerade;
    if (runtime.kind === "inactive" || runtime.kind === "ending") return;
    const state = runtime.state;
    if (!state) return;
    this.acquireSuspension();
    const generation = ++this.generation;
    useStore.getState().setMasquerade({ kind: "ending", state, generation });
    void this.restoreAfterServerEnd(state, generation);
  }

  private async restoreAfterServerEnd(state: MasqueradeState, generation: number): Promise<void> {
    try {
      const projected = await this.dependencies.reproject(state.accountId);
      if (!this.ownsRuntime(generation, "ending")) return;
      if (!projected) {
        this.fail("The masquerade ended, but the real account view could not be restored. Retry.");
        return;
      }
    } catch (error) {
      if (!this.ownsRuntime(generation, "ending")) return;
      console.error("The real account projection could not be restored", error);
      this.fail("The masquerade ended, but the real account view could not be restored. Retry.");
      return;
    }
    if (!this.ownsRuntime(generation, "ending")) return;
    this.releaseSuspension({ dropParkedEdits: true });
    useStore.getState().clearUndoHistory();
    useStore.getState().setMasquerade({ kind: "inactive" });
  }
}

export const masqueradeController = new MasqueradeController({
  flush: flushPendingWrites,
  suspend: suspendServerWrites,
  reproject: reprojectAccess,
  switchAccount: switchAndAwaitHydration,
  api: masqueradeApi,
});

setMasqueradeEndedHandler(() => masqueradeController.restoreServerEndedProjection());
