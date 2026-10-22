// Build provenance for tester bug reports, read from the build-time
// env like apiConfig. The deploy script sets VITE_CAPACITYLENS_BUILD_SHA; a build without it (dev
// server, plain local build) renders no stamp at all. The mode suffix exists because the demo
// build looks otherwise identical to a real server deploy. The stamp is how the
// post-deploy smoke test proves the deploy really is in server mode, not the demo build.

import { isServerConfigured } from "./apiConfig";
import { APP_NAME } from "@capacitylens/shared/brand";
import { isAccountEmail } from "@capacitylens/shared/account/validation";
import { EXPORT_SCHEMA_VERSION } from "@capacitylens/shared/types/entities";
import packageJson from "../../../../package.json";
import { isRecord } from "@capacitylens/shared/lib/isRecord";
import type { AccountMode } from "@capacitylens/shared/account/types";

/** Whether the observed diagnostics response was reachable; `unavailable` means no response was usable. */
export type DiagnosticsConnectivity = "ok" | "unavailable";
/** Whether the observed database schema could be read safely; `unavailable` means the value is unknown. */
export type DiagnosticsDatabaseStatus = "ok" | "unavailable";

/** Fixed server fields allowed into a client diagnostics snapshot. */
export interface ServerDiagnostics {
  connectivity: DiagnosticsConnectivity;
  database: {
    status: DiagnosticsDatabaseStatus;
  };
  schema: { migration: string | null };
  backup: { newestSnapshotAt: string | null };
}

/** Browser facts a support report may carry; none identifies a person or a company. */
export interface BrowserDiagnostics {
  userAgent: string;
  /** CSS-pixel viewport, e.g. `1280×800`. */
  viewport: string;
  timeZone: string;
  language: string;
}

/** Facts known only to the running client: its sign-in mode and browser. */
export interface ClientDiagnostics {
  signInMode: AccountMode;
  browser: BrowserDiagnostics;
}

/** Privacy-safe client report captured for a local demo or server observation; it is not a live monitor. */
export interface DiagnosticsReport {
  /** Client ISO timestamp for a local demo snapshot, server response, or observed failure; null means it is still pending. */
  observedAt: string | null;
  appVersion: string;
  buildRevision: string | null;
  deploymentMode: "server" | "demo";
  exportSchema: number;
  server: ServerDiagnostics;
  client: ClientDiagnostics;
}

const UNKNOWN = "Unknown";

function createUnknownServerDiagnostics(): ServerDiagnostics {
  return {
    connectivity: "unavailable",
    database: { status: "unavailable" },
    schema: { migration: null },
    backup: { newestSnapshotAt: null },
  };
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
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    return null;
  return value;
}

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && values.includes(value as T);

function parseServerDiagnostics(value: unknown): ServerDiagnostics {
  if (!isRecord(value)) return createUnknownServerDiagnostics();
  const database = isRecord(value.database) ? value.database : null;
  const schema = isRecord(value.schema) ? value.schema : null;
  const backup = isRecord(value.backup) ? value.backup : null;
  return {
    connectivity: readConnectivity(value.connectivity),
    database: readDatabaseProjection(database),
    schema: readSchemaProjection(schema, readDatabaseStatus(database?.status)),
    backup: readBackupProjection(backup),
  };
}

function readConnectivity(value: unknown): DiagnosticsConnectivity {
  return value === "ok" ? "ok" : "unavailable";
}

function readDatabaseStatus(value: unknown): DiagnosticsDatabaseStatus {
  return isOneOf(value, ["ok", "unavailable"] as const) ? value : "unavailable";
}

function readDatabaseProjection(database: Record<string, unknown> | null) {
  return { status: readDatabaseStatus(database?.status) };
}

function readSchemaProjection(schema: Record<string, unknown> | null, databaseStatus: DiagnosticsDatabaseStatus) {
  const migration = databaseStatus === "ok" ? schema?.migration : null;
  return {
    migration:
      typeof migration === "string" && /^database\/migrations\/\d{12}_[a-z0-9_]{1,100}$/.test(migration)
        ? migration
        : null,
  };
}

function readBackupProjection(backup: Record<string, unknown> | null) {
  return { newestSnapshotAt: readTimestamp(backup?.newestSnapshotAt) };
}

function readMatching(value: string, pattern: RegExp): string {
  return pattern.test(value) ? value : UNKNOWN;
}

// Restrict browser facts to fixed shapes so support reports cannot carry arbitrary private text.
function readBrowserProjection(browser: BrowserDiagnostics): BrowserDiagnostics {
  return {
    // A user agent may carry a crawler URL or contact address; such a string is dropped whole.
    userAgent: readMatching(browser.userAgent, /^(?!.*(?::\/\/|@))[\x20-\x7e]{1,512}$/),
    viewport: readMatching(browser.viewport, /^\d{1,5}×\d{1,5}$/),
    timeZone: readMatching(browser.timeZone, /^[A-Za-z0-9_+\-/]{1,64}$/),
    language: readMatching(browser.language, /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/),
  };
}

/** Read this browser's report facts. Each falls back to `Unknown` where the browser withholds it. */
export function readBrowserDiagnostics(): BrowserDiagnostics {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    userAgent: navigator.userAgent || UNKNOWN,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    timeZone: timeZone || UNKNOWN,
    language: navigator.language || UNKNOWN,
  };
}

/** Build the fixed, privacy-safe diagnostics projection. Unknown server fields are ignored. */
export function readDiagnostics(
  serverResponse: unknown,
  observedAt: string | undefined,
  client: ClientDiagnostics,
): DiagnosticsReport {
  return {
    observedAt: readTimestamp(observedAt) ?? null,
    appVersion: packageJson.version,
    buildRevision: readBuildRevision(),
    deploymentMode: isServerConfigured() ? "server" : "demo",
    // The export schema is a client-side format marker; it is deliberately not presented as the
    // physical server schema, which is supplied separately by the authenticated diagnostics route.
    exportSchema: EXPORT_SCHEMA_VERSION,
    server: parseServerDiagnostics(isRecord(serverResponse) ? serverResponse.server : null),
    client: { ...client, browser: readBrowserProjection(client.browser) },
  };
}

/** Format diagnostics as stable labelled text for support reports. It contains no raw response data. */
export function formatDiagnostics(report: DiagnosticsReport): string {
  const { server } = report;
  const { browser } = report.client;
  return [
    `${APP_NAME} diagnostics`,
    `Snapshot observed: ${report.observedAt ?? UNKNOWN}`,
    `App version: ${report.appVersion}`,
    `Build revision: ${report.buildRevision ?? UNKNOWN}`,
    `Deployment mode: ${report.deploymentMode}`,
    `Export schema: ${report.exportSchema}`,
    `Server connectivity: ${server.connectivity}`,
    `Database: ${server.database.status}`,
    `Schema migration: ${server.schema.migration ?? UNKNOWN}`,
    `Newest snapshot: ${server.backup.newestSnapshotAt ?? UNKNOWN}`,
    `Sign-in mode: ${report.client.signInMode}`,
    `User agent: ${browser.userAgent}`,
    `Viewport: ${browser.viewport}`,
    `Time zone: ${browser.timeZone}`,
    `Language: ${browser.language}`,
  ].join("\n");
}

function readOptionalEnvironmentString(value: unknown, variableName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${variableName} must be a string.`);
  }
  return value;
}

/** The muted Diagnostics build line, e.g. `build a1b2c3d · server`, or null when the build
 * carries no sha. */
export function readBuildStamp(): string | null {
  const revision = readBuildRevision();
  if (!revision) return null;
  return `build ${revision} · ${isServerConfigured() ? "server" : "demo"}`;
}

/** The Diagnostics "Send feedback" mailto href (flag VITE_CAPACITYLENS_FEEDBACK_MAILTO), or
 * null when the build carries no address (render nothing). The subject carries the build
 * stamp when there is one, so tester reports arrive pinned to a build. */
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
