/**
 * Names a supported Playwright project.
 */
export type PlaywrightProjectName = "chromium" | "db-backed" | "auth-backed" | "webkit" | "firefox";

/**
 * Defines the environment flags and projects for a preset E2E run.
 */
export interface E2ERunPreset {
  environment: Readonly<Record<string, string>>;
  projects: readonly PlaywrightProjectName[];
}

/**
 * Preconfigured multi-browser E2E run modes.
 */
export const E2E_RUN_PRESETS: Readonly<
  Record<"chromiumWebkit" | "firefoxOnly" | "standard" | "webkitOnly", E2ERunPreset>
>;

/**
 * Returns the API origin selected for a Playwright run.
 */
export function serverTestApiOrigin(
  laneApiPort: number,
  environment?: Readonly<Record<string, string | undefined>>,
): string;

/**
 * Resolves the Playwright projects and server profile from run settings.
 * @throws When incompatible run modes are selected.
 */
export function resolvePlaywrightRunMode(
  environment: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
  selectsOnlyExplicitCoreSpecs: (argv: readonly string[]) => boolean,
): {
  projects: readonly PlaywrightProjectName[];
  serverProfile: "vite" | "standard";
};
