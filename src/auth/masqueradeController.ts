import type {
  ClientMasqueradeEndReason,
  MasqueradeState,
  MasqueradeStatus,
} from "@capacitylens/shared/domain/masquerade";
import { flushPendingWrites, suspendServerWrites, switchAndAwaitHydration, type RefreshOutcome } from "../data/persist";
import { setMasqueradeEndedHandler } from "../data/requestTimeout";
import { useStore } from "../store/useStore";
import { masqueradeApi } from "./masqueradeApi";
import { reprojectAccess } from "./reprojectAccess";

type ResumeWrites = (opts?: { dropParkedEdits?: boolean }) => void;

export interface MasqueradeControllerDependencies {
  flush: () => Promise<boolean>;
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
  private pendingState: MasqueradeState | null = null;

  constructor(dependencies: MasqueradeControllerDependencies) {
    this.dependencies = dependencies;
  }

  private acquireSuspension(): void {
    this.resumeWrites ??= this.dependencies.suspend();
  }

  private releaseSuspension(dropParkedEdits: boolean): void {
    const resume = this.resumeWrites;
    this.resumeWrites = null;
    resume?.({ dropParkedEdits });
  }

  private fail(message: string): false {
    useStore.getState().setNotice(message, "error");
    return false;
  }

  async start(accountId: string, targetUserId: string): Promise<boolean> {
    if (useStore.getState().masquerade.phase !== "inactive") {
      return this.fail("End the current masquerade before starting another.");
    }
    if (!(await this.dependencies.flush())) {
      return this.fail("Save pending changes before starting a masquerade.");
    }

    const generation = ++this.generation;
    this.acquireSuspension();
    useStore.getState().setMasquerade({ phase: "starting", pending: { accountId, targetUserId }, generation });
    let state: MasqueradeState;
    try {
      state = await this.dependencies.api.start(accountId, targetUserId);
    } catch (error) {
      this.pendingState = null;
      this.releaseSuspension(false);
      useStore.getState().setMasquerade({ phase: "inactive" });
      return this.fail(error instanceof Error ? error.message : "Masquerade could not be started.");
    }
    if (generation !== this.generation) return false;
    this.pendingState = state;
    try {
      if (!(await this.dependencies.reproject(accountId))) {
        return this.fail("The member view started, but its data could not be loaded. Retry or end the masquerade.");
      }
    } catch (error) {
      console.error("Masquerade target projection could not be loaded", error);
      return this.fail("The member view started, but its data could not be loaded. Retry or end the masquerade.");
    }
    useStore.getState().clearUndoHistory();
    useStore.getState().setMasquerade({ phase: "active", state, generation });
    return true;
  }

  async retryProjection(): Promise<boolean> {
    const runtime = useStore.getState().masquerade;
    if (runtime.phase === "inactive") return false;
    const state = runtime.phase === "starting" ? this.pendingState : runtime.state;
    if (!state) return false;
    if (!(await this.dependencies.reproject(state.accountId))) return this.fail("The member view could not be loaded.");
    useStore.getState().clearUndoHistory();
    useStore.getState().setMasquerade({ phase: "active", state, generation: runtime.generation });
    return true;
  }

  async end(reason: ClientMasqueradeEndReason = "explicit", navigate?: (to: string) => void): Promise<boolean> {
    const runtime = useStore.getState().masquerade;
    const state =
      runtime.phase === "starting" ? this.pendingState : runtime.phase !== "inactive" ? runtime.state : null;
    if (!state) return true;
    const generation = ++this.generation;
    this.acquireSuspension();
    useStore.getState().setMasquerade({ phase: "ending", state, generation });
    try {
      await this.dependencies.api.end(state.token, reason);
      const status = await this.dependencies.api.status();
      if (status.active) {
        this.pendingState = status;
        useStore.getState().setMasquerade({ phase: "active", state: status, generation });
        return true;
      }
      if (!(await this.dependencies.reproject(state.accountId))) {
        return this.fail("The real account view could not be restored. Retry ending the masquerade.");
      }
      this.pendingState = null;
      this.releaseSuspension(true);
      useStore.getState().clearUndoHistory();
      useStore.getState().setMasquerade({ phase: "inactive" });
      navigate?.("/");
      return true;
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : "Masquerade could not be ended.");
    }
  }

  async transitionAccount(accountId: string | null): Promise<boolean> {
    const runtime = useStore.getState().masquerade;
    if (runtime.phase === "inactive") {
      const outcome = await this.dependencies.switchAccount(accountId);
      return outcome === "reloaded" || (accountId === null && outcome !== "failed");
    }
    const state = runtime.phase === "starting" ? this.pendingState : runtime.state;
    if (!state) return this.fail("Wait for the current masquerade transition to finish.");
    const generation = ++this.generation;
    this.acquireSuspension();
    useStore.getState().setMasquerade({ phase: "ending", state, generation });
    try {
      await this.dependencies.api.end(state.token, "account_switch");
      const status = await this.dependencies.api.status();
      if (status.active) {
        this.pendingState = status;
        useStore.getState().setMasquerade({ phase: "active", state: status, generation });
        return this.fail("A newer masquerade is active. End it before switching companies.");
      }
      const outcome = await this.dependencies.switchAccount(accountId);
      if (outcome !== "reloaded" && !(accountId === null && outcome !== "failed")) {
        return this.fail("The selected company could not be loaded.");
      }
      this.pendingState = null;
      this.releaseSuspension(true);
      useStore.getState().clearUndoHistory();
      useStore.getState().setMasquerade({ phase: "inactive" });
      return true;
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : "The company switch could not be completed.");
    }
  }

  /** Adopt status before PermissionProvider publishes an effective role, preventing a writable frame. */
  adoptStatus(status: MasqueradeStatus): void {
    if (!status.active) return;
    const current = useStore.getState().masquerade;
    // The controller already owns these transitions. A membership invalidation triggered by its
    // own reproject must not publish `active` before that authoritative reload has completed.
    if (current.phase === "starting" || current.phase === "ending") return;
    this.acquireSuspension();
    this.pendingState = status;
    useStore.getState().setMasquerade({ phase: "active", state: status, generation: ++this.generation });
  }

  /** A projected read reported that server-side revalidation ended this session's masquerade. */
  handleServerEnded(): void {
    const runtime = useStore.getState().masquerade;
    if (runtime.phase === "inactive" || runtime.phase === "ending") return;
    const state = runtime.phase === "starting" ? this.pendingState : runtime.state;
    if (!state) return;
    this.acquireSuspension();
    useStore.getState().setMasquerade({ phase: "ending", state, generation: ++this.generation });
    void this.restoreAfterServerEnd(state);
  }

  private async restoreAfterServerEnd(state: MasqueradeState): Promise<void> {
    if (!(await this.dependencies.reproject(state.accountId))) {
      this.fail("The masquerade ended, but the real account view could not be restored. Retry.");
      return;
    }
    this.pendingState = null;
    this.releaseSuspension(true);
    useStore.getState().clearUndoHistory();
    useStore.getState().setMasquerade({ phase: "inactive" });
  }
}

export const masqueradeController = new MasqueradeController({
  flush: flushPendingWrites,
  suspend: suspendServerWrites,
  reproject: reprojectAccess,
  switchAccount: switchAndAwaitHydration,
  api: masqueradeApi,
});

setMasqueradeEndedHandler(() => masqueradeController.handleServerEnded());
