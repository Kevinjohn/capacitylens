// Build provenance for tester bug reports (production plan P1.7), read from the build-time
// env like apiConfig. The deploy script sets VITE_CAPACITYLENS_BUILD_SHA; a build without it (dev
// server, plain local build) renders no stamp at all. The mode suffix exists because the demo
// build looks otherwise identical to a real server deploy — the stamp is how the
// post-deploy smoke test proves the deploy really is in server mode, not the demo build.

import { isServerConfigured } from "./apiConfig";
import { APP_NAME } from "@capacitylens/shared/brand";
import { isAccountEmail } from "@capacitylens/shared/account/validation";
import { EXPORT_SCHEMA_VERSION } from "@capacitylens/shared/types/entities";
import packageJson from "../../package.json";

export type DiagnosticsConnectivity = "ok" | "unavailable";
export type DiagnosticsDatabaseStatus = "ok" | "unavailable";
export type DiagnosticsPersistenceStatus = "ok" | "degraded" | "unknown";
export type DiagnosticsBackupStatus = "ok" | "degraded" | "pending" | "unavailable";

export interface ServerDiagnostics {
  connectivity: DiagnosticsConnectivity;
  database: { status: DiagnosticsDatabaseStatus; schemaVersion: number | null };
  persistence: DiagnosticsPersistenceStatus;
  backup: { status: DiagnosticsBackupStatus; lastSuccessAt: string | null };
}

export interface DiagnosticsReport {
  appVersion: string;
  buildRevision: string | null;
  deploymentMode: "server" | "demo";
  exportSchema: number;
  server: ServerDiagnostics;
}

const UNKNOWN_SERVER_DIAGNOSTICS: ServerDiagnostics = {
  connectivity: "unavailable",
  database: { status: "unavailable", schemaVersion: null },
  persistence: "unknown",
  backup: { status: "unavailable", lastSuccessAt: null },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBuildRevision(): string | null {
  const revision = (
    readOptionalEnvironmentString(import.meta.env.VITE_CAPACITYLENS_BUILD_SHA, "VITE_CAPACITYLENS_BUILD_SHA") ?? ""
  ).trim();
  return /^[0-9a-f]{7,64}$/i.test(revision) ? revision : null;
}

function readTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return null;
  return value;
}

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && values.includes(value as T);

function parseServerDiagnostics(value: unknown): ServerDiagnostics {
  if (!isRecord(value)) return UNKNOWN_SERVER_DIAGNOSTICS;
  const database = isRecord(value.database) ? value.database : null;
  const backup = isRecord(value.backup) ? value.backup : null;
  return {
    connectivity: readConnectivity(value.connectivity),
    database: readDatabaseProjection(value.databaseStatus, database),
    persistence: readPersistenceStatus(value.persistence),
    backup: readBackupProjection(backup),
  };
}

function readConnectivity(value: unknown): DiagnosticsConnectivity {
  return value === "ok" ? "ok" : "unavailable";
}

function readDatabaseStatus(primary: unknown, secondary: unknown): DiagnosticsDatabaseStatus {
  if (isOneOf(primary, ["ok", "unavailable"] as const)) return primary;
  if (isOneOf(secondary, ["ok", "unavailable"] as const)) return secondary;
  return "unavailable";
}

function readSchemaVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readDatabaseProjection(primary: unknown, database: Record<string, unknown> | null) {
  const declared = readDatabaseStatus(primary, database?.status);
  const schemaVersion = readSchemaVersion(database?.schemaVersion);
  return {
    status: declared === "ok" && schemaVersion !== null ? ("ok" as const) : ("unavailable" as const),
    schemaVersion,
  };
}

function readPersistenceStatus(value: unknown): DiagnosticsPersistenceStatus {
  return isOneOf(value, ["ok", "degraded", "unknown"] as const) ? value : "unknown";
}

function readBackupProjection(backup: Record<string, unknown> | null) {
  const status = isOneOf(backup?.status, ["ok", "degraded", "pending", "unavailable"] as const)
    ? backup.status
    : ("unavailable" as const);
  return { status, lastSuccessAt: readTimestamp(backup?.lastSuccessAt) };
}

/** Build the fixed, privacy-safe diagnostics projection. Unknown server fields are ignored. */
export function readDiagnostics(serverResponse: unknown = null): DiagnosticsReport {
  return {
    appVersion: packageJson.version,
    buildRevision: readBuildRevision(),
    deploymentMode: isServerConfigured() ? "server" : "demo",
    // The export schema is a client-side format marker; it is deliberately not presented as the
    // physical server schema, which is supplied separately by the authenticated diagnostics route.
    exportSchema: EXPORT_SCHEMA_VERSION,
    server: parseServerDiagnostics(isRecord(serverResponse) ? serverResponse.server : null),
  };
}

/** Format diagnostics as stable labelled text for support reports. It contains no raw response data. */
export function formatDiagnostics(report: DiagnosticsReport): string {
  const { server } = report;
  return [
    `${APP_NAME} diagnostics`,
    `App version: ${report.appVersion}`,
    `Build revision: ${report.buildRevision ?? "Unknown"}`,
    `Deployment mode: ${report.deploymentMode}`,
    `Export schema: ${report.exportSchema}`,
    `Server connectivity: ${server.connectivity}`,
    `Database: ${server.database.status}`,
    `Database schema: ${server.database.schemaVersion ?? "Unknown"}`,
    `Persistence: ${server.persistence}`,
    `Backup: ${server.backup.status}`,
    `Backup last success: ${server.backup.lastSuccessAt ?? "Unknown"}`,
  ].join("\n");
}

function readOptionalEnvironmentString(value: unknown, variableName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${variableName} must be a string.`);
  }
  return value;
}

/** The muted Settings footer line, e.g. `build a1b2c3d · server`, or null when the build
 *  carries no sha (render nothing — today's Settings exactly). */
export function readBuildStamp(): string | null {
  const revision = readBuildRevision();
  if (!revision) return null;
  return `build ${revision} · ${isServerConfigured() ? "server" : "demo"}`;
}

/** The Settings "Send feedback" mailto href (P5.2, flag VITE_CAPACITYLENS_FEEDBACK_MAILTO), or
 *  null when the build carries no address (render nothing). The subject carries the build
 *  stamp when there is one, so tester reports arrive pinned to a build. */
export function readFeedbackMailto(): string | null {
  const addr = (
    readOptionalEnvironmentString(
      import.meta.env.VITE_CAPACITYLENS_FEEDBACK_MAILTO,
      "VITE_CAPACITYLENS_FEEDBACK_MAILTO",
    ) ?? ""
  ).trim();
  if (!isAccountEmail(addr)) return null;
  const atSignIndex = addr.indexOf("@");
  const recipient = `${encodeURIComponent(addr.slice(0, atSignIndex))}@${encodeURIComponent(addr.slice(atSignIndex + 1))}`;
  const stamp = readBuildStamp();
  const subject = stamp ? `${APP_NAME} feedback — ${stamp}` : `${APP_NAME} feedback`;
  return `mailto:${recipient}?subject=${encodeURIComponent(subject)}`;
}
