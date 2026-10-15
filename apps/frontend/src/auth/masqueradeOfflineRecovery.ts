import {
  beginMasqueradeRestorationWrites,
  clearOfflineDataForCurrentUser,
  finishMasqueradeRestorationWrites,
  isMasqueradeOfflineIsolated,
  isOfflineReadEnabled,
  markMasqueradeOfflineIsolation,
} from "@/data/offlineCache";
import type { MasqueradeStatus } from "@capacitylens/shared/domain/masquerade";

interface MasqueradeOfflineRecoveryDependencies {
  refreshIdentity: () => Promise<boolean>;
  refreshSummaries: () => Promise<boolean>;
}

/** Owns the offline snapshot boundary around a real or projected member identity. */
export class MasqueradeOfflineRecovery {
  private readonly dependencies: MasqueradeOfflineRecoveryDependencies;
  private prepared = false;

  constructor(dependencies: MasqueradeOfflineRecoveryDependencies) {
    this.dependencies = dependencies;
  }

  isIsolated(): boolean {
    return isMasqueradeOfflineIsolated();
  }

  mark(): void {
    markMasqueradeOfflineIsolation();
  }

  async prepare(): Promise<void> {
    this.mark();
    if (this.prepared) return;
    // Fence writes already in IndexedDB even if offline reading was disabled during their flight.
    if (isOfflineReadEnabled() || typeof indexedDB !== "undefined") await clearOfflineDataForCurrentUser();
    this.prepared = true;
  }

  beginRestorationWrites(): void {
    beginMasqueradeRestorationWrites();
  }

  finish(restored: boolean): void {
    finishMasqueradeRestorationWrites(restored);
    if (restored) this.prepared = false;
  }

  refreshSummaries(): Promise<boolean> {
    return this.dependencies.refreshSummaries();
  }

  async transitionAccount<T>({
    readStatus,
    adoptActiveStatus,
    switchAccount,
    isSuccessful,
    isGenerationCurrent,
    isAccountSelected,
  }: {
    readStatus: () => Promise<MasqueradeStatus>;
    adoptActiveStatus: (status: Extract<MasqueradeStatus, { active: true }>) => Promise<void>;
    switchAccount: () => Promise<T>;
    isSuccessful: (outcome: T) => boolean;
    isGenerationCurrent: () => boolean;
    isAccountSelected: () => boolean;
  }): Promise<boolean> {
    const status = await readStatus();
    if (status.active) {
      await adoptActiveStatus(status);
      return false;
    }
    this.beginRestorationWrites();
    let restored = false;
    try {
      if (!(await this.dependencies.refreshIdentity()) || !isGenerationCurrent()) return false;
      const outcome = await switchAccount();
      if (!isSuccessful(outcome) || !isGenerationCurrent() || !isAccountSelected()) return false;
      if (!(await this.refreshSummaries())) return true;
      if (!isGenerationCurrent() || !isAccountSelected()) return false;
      this.finish(true);
      restored = true;
      return true;
    } finally {
      if (!restored) this.finish(false);
    }
  }

  async establishRealIdentity(isCurrent: () => boolean): Promise<boolean> {
    if (!this.isIsolated()) return true;
    return (await this.dependencies.refreshIdentity()) && isCurrent();
  }
}
