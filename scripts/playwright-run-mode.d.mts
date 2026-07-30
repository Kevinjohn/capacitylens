export type PlaywrightProjectName =
  "chromium" | "db-backed" | "auth-backed" | "oidc-backed" | "webkit" | "firefox" | "rehearsal";

export interface E2ERunPreset {
  environment: Readonly<Record<string, string>>;
  projects: readonly PlaywrightProjectName[];
}

export const E2E_RUN_PRESETS: Readonly<
  Record<"chromiumWebkit" | "firefoxOnly" | "standard" | "webkitOnly", E2ERunPreset>
>;

export function resolvePlaywrightRunMode(
  environment: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
  selectsOnlyExplicitCoreSpecs: (argv: readonly string[]) => boolean,
): {
  projects: readonly PlaywrightProjectName[];
  serverProfile: "rehearsal" | "oidc" | "vite" | "standard";
};
