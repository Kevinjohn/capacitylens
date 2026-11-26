import type { ApplicationService } from '@adonisjs/core/types';
import type { SqliteBackup } from '@kevinjohn/adonisjs-sqlite-backup';
import BackupProvider from '#providers/backup_provider';
import PackageCallbacksProvider from '#providers/package_callbacks_provider';
import { AdmissionRuleService } from '#services/account_kit/admission_rule_service';

export function makeApplication(
  backup: BackupService,
  environment = 'web',
  directory = backup.config.directory
) {
  return {
    getEnvironment: () => environment,
    config: {
      get: (key: string) => (key === 'backup' ? { ...backup.config, directory } : undefined),
    },
    container: {
      make: async (key: string) => {
        if (key !== 'sqlite.backup') throw new Error(`Unexpected binding ${key}`);
        return backup;
      },
    },
  } as unknown as ApplicationService;
}

export type BackupService = Pick<
  SqliteBackup,
  'config' | 'livePath' | 'checkSource' | 'prepareDirectory' | 'create' | 'prune'
>;
export const DAY_MS = 24 * 60 * 60_000;

export class LoggedProvider extends BackupProvider {
  messages: string[] = [];
  levels = new Map<string, string>();
  protected log(message: string, level = 'info') {
    this.messages.push(message);
    this.levels.set(message, level);
  }
}

type Factory = () => unknown;

/** Boots the provider against a recording container and returns the factories it registered. */
export async function registerCallbacks(rules: unknown) {
  const factories: Record<string, Factory> = {};
  const made: unknown[] = [];
  const services = {
    recordInvitationAccepted: async () => {},
    withDeletionRecords: (callback: unknown) => callback,
    requireRegistrationDisplayName: () => 'Diana Prince',
  };
  const container = {
    make: async (key: unknown) => {
      made.push(key);
      if (typeof key === 'string') {
        return { register: (factory: Factory) => (factories[key] = factory) };
      }
      return key === AdmissionRuleService ? rules : services;
    },
  };
  await new PackageCallbacksProvider({ container } as unknown as ApplicationService).boot();
  return { factories, made };
}
