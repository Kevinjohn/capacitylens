const enabled = (environment, name) => environment[name] === "1";

/** The reset and direct API calls follow the claimed local lane. */
export function serverTestApiOrigin(laneApiPort) {
  return `http://localhost:${laneApiPort}`;
}

/**
 * Preconfigured multi-browser E2E run modes.
 */
export const E2E_RUN_PRESETS = Object.freeze({
  chromiumWebkit: Object.freeze({
    environment: Object.freeze({ CAPACITYLENS_WEBKIT: "1", CAPACITYLENS_VITE_ONLY: "1" }),
    projects: Object.freeze(["chromium", "webkit"]),
  }),
  firefoxOnly: Object.freeze({
    environment: Object.freeze({ CAPACITYLENS_FIREFOX_ONLY: "1" }),
    projects: Object.freeze(["firefox"]),
  }),
  standard: Object.freeze({ environment: Object.freeze({}), projects: Object.freeze([]) }),
  webkitOnly: Object.freeze({
    environment: Object.freeze({ CAPACITYLENS_WEBKIT_ONLY: "1" }),
    projects: Object.freeze(["webkit"]),
  }),
});

const MODE_FLAGS = [
  "CAPACITYLENS_WEBKIT",
  "CAPACITYLENS_WEBKIT_ONLY",
  "CAPACITYLENS_FIREFOX",
  "CAPACITYLENS_FIREFOX_ONLY",
  "CAPACITYLENS_VITE_ONLY",
  "CAPACITYLENS_REHEARSAL_URL",
];

/** Explicit presets replace all inherited mode selection while preserving unrelated settings. */
export function presetEnvironment(environment, preset) {
  const selected = { ...environment };
  for (const flag of MODE_FLAGS) delete selected[flag];
  return { ...selected, ...preset };
}

/**
 * Resolve projects and supporting servers from one flag interpretation.
 * Returns a frozen result without changing the supplied inputs.
 * @throws When both single-engine flags are set.
 */
export function resolvePlaywrightRunMode(environment, argv, selectsOnlyExplicitCoreSpecs) {
  const webkitOnly = enabled(environment, "CAPACITYLENS_WEBKIT_ONLY");
  const firefoxOnly = enabled(environment, "CAPACITYLENS_FIREFOX_ONLY");
  if (webkitOnly && firefoxOnly) throw new Error("WebKit-only and Firefox-only modes are mutually exclusive.");

  const explicitCoreOnly = selectsOnlyExplicitCoreSpecs(argv);
  const viteOnly = enabled(environment, "CAPACITYLENS_VITE_ONLY") || webkitOnly || firefoxOnly || explicitCoreOnly;
  const projects = [];
  if (webkitOnly) projects.push("webkit");
  else if (firefoxOnly) projects.push("firefox");
  else {
    projects.push("chromium");
    if (!viteOnly) projects.push("db-backed", "auth-backed");
    if (enabled(environment, "CAPACITYLENS_WEBKIT")) projects.push("webkit");
    if (enabled(environment, "CAPACITYLENS_FIREFOX")) projects.push("firefox");
  }

  return Object.freeze({
    projects: Object.freeze(projects),
    serverProfile: viteOnly ? "vite" : "standard",
  });
}
