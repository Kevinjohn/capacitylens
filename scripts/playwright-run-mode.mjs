const enabled = (environment, name) => environment[name] === "1";

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

/** Resolve projects and supporting servers from one flag interpretation. */
export function resolvePlaywrightRunMode(environment, argv, selectsOnlyExplicitCoreSpecs) {
  const webkitOnly = enabled(environment, "CAPACITYLENS_WEBKIT_ONLY");
  const firefoxOnly = enabled(environment, "CAPACITYLENS_FIREFOX_ONLY");
  if (webkitOnly && firefoxOnly) throw new Error("WebKit-only and Firefox-only modes are mutually exclusive.");

  const oidcOnly = enabled(environment, "CAPACITYLENS_OIDC_E2E");
  const rehearsal = Boolean(environment.CAPACITYLENS_REHEARSAL_URL);
  if (oidcOnly && rehearsal) throw new Error("OIDC and rehearsal modes are mutually exclusive.");
  if ((oidcOnly || rehearsal) && (webkitOnly || firefoxOnly)) {
    throw new Error("OIDC/rehearsal modes cannot be combined with a single-browser core mode.");
  }

  const explicitCoreOnly = selectsOnlyExplicitCoreSpecs(argv);
  const viteOnly = enabled(environment, "CAPACITYLENS_VITE_ONLY") || webkitOnly || firefoxOnly || explicitCoreOnly;
  const projects = [];
  if (oidcOnly) projects.push("oidc-backed");
  else if (rehearsal) projects.push("rehearsal");
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
    serverProfile: rehearsal ? "rehearsal" : oidcOnly ? "oidc" : viteOnly ? "vite" : "standard",
  });
}
