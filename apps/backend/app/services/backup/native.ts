// The native driver has no declaration package in this workspace; keep its consumed surface explicit.
// @ts-expect-error better-sqlite3 does not publish declarations
import Database from 'better-sqlite3'

/** Native driver operations consumed by the backup boundary. */
export interface NativeDatabase {
  prepare(sql: string): { get(): unknown; all(): unknown[]; run(): unknown }
  pragma(sql: string): unknown
  backup(path: string): Promise<unknown>
  close(): void
}

/** Open a native SQLite handle without creating a missing source when requested. */
export function openNativeDatabase(
  path: string,
  options?: { fileMustExist?: boolean; readonly?: boolean }
): NativeDatabase {
  return new Database(path, options) as NativeDatabase
}
