const enabled = (environment, name) => environment[name] === "1";

/** The reset and direct API calls follow the server selected by this Playwright run. */
export function serverTestApiOrigin(laneApiPort, environment = process.env) {
  const rehearsalUrl = environment.CAPACITYLENS_REHEARSAL_URL;
  if (!rehearsalUrl) return `http://localhost:${laneApiPort}`;
  const url = new URL(rehearsalUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("CAPACITYLENS_REHEARSAL_URL must be an HTTP(S) URL without credentials.");
  }
  return url.origin;
}

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

/** Resolve projects and supporting servers from one flag interpretation. */
export function resolvePlaywrightRunMode(environment, argv, selectsOnlyExplicitCoreSpecs) {
  const webkitOnly = enabled(environment, "CAPACITYLENS_WEBKIT_ONLY");
  const firefoxOnly = enabled(environment, "CAPACITYLENS_FIREFOX_ONLY");
  if (webkitOnly && firefoxOnly) throw new Error("WebKit-only and Firefox-only modes are mutually exclusive.");

  const rehearsal = Boolean(environment.CAPACITYLENS_REHEARSAL_URL);
  if (rehearsal && (webkitOnly || firefoxOnly)) {
    throw new Error("Rehearsal mode cannot be combined with a single-browser core mode.");
  }

  const explicitCoreOnly = selectsOnlyExplicitCoreSpecs(argv);
  const viteOnly = enabled(environment, "CAPACITYLENS_VITE_ONLY") || webkitOnly || firefoxOnly || explicitCoreOnly;
  const projects = [];
  if (rehearsal) projects.push("rehearsal");
  else if (webkitOnly) projects.push("webkit");
  else if (firefoxOnly) projects.push("firefox");
  else {
    projects.push("chromium");
    if (!viteOnly) projects.push("db-backed", "auth-backed");
    if (enabled(environment, "CAPACITYLENS_WEBKIT")) projects.push("webkit");
    if (enabled(environment, "CAPACITYLENS_FIREFOX")) projects.push("firefox");
  }

  return Object.freeze({
    projects: Object.freeze(projects),
    serverProfile: rehearsal ? "rehearsal" : viteOnly ? "vite" : "standard",
  });
}
