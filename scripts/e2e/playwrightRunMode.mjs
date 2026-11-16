const enabled = (environment, name) => environment[name] === '1';

/**
 * Preconfigured multi-browser E2E run modes.
 */
export const E2E_RUN_PRESETS = Object.freeze({
  chromiumWebkit: Object.freeze({
    environment: Object.freeze({ CAPACITYLENS_WEBKIT: '1', CAPACITYLENS_BROWSER_ONLY: '1' }),
    projects: Object.freeze(['chromium', 'webkit']),
  }),
  firefoxOnly: Object.freeze({
    environment: Object.freeze({ CAPACITYLENS_FIREFOX_ONLY: '1' }),
    projects: Object.freeze(['firefox']),
  }),
  standard: Object.freeze({ environment: Object.freeze({}), projects: Object.freeze([]) }),
  webkitOnly: Object.freeze({
    environment: Object.freeze({ CAPACITYLENS_WEBKIT_ONLY: '1' }),
    projects: Object.freeze(['webkit']),
  }),
});

const MODE_FLAGS = [
  'CAPACITYLENS_WEBKIT',
  'CAPACITYLENS_WEBKIT_ONLY',
  'CAPACITYLENS_FIREFOX',
  'CAPACITYLENS_FIREFOX_ONLY',
  'CAPACITYLENS_BROWSER_ONLY',
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
export function resolvePlaywrightRunMode(environment) {
  const webkitOnly = enabled(environment, 'CAPACITYLENS_WEBKIT_ONLY');
  const firefoxOnly = enabled(environment, 'CAPACITYLENS_FIREFOX_ONLY');
  if (webkitOnly && firefoxOnly)
    throw new Error('WebKit-only and Firefox-only modes are mutually exclusive.');

  const browserOnly =
    enabled(environment, 'CAPACITYLENS_BROWSER_ONLY') || webkitOnly || firefoxOnly;
  const projects = [];
  if (webkitOnly) projects.push('webkit');
  else if (firefoxOnly) projects.push('firefox');
  else {
    projects.push('chromium');
    if (!browserOnly) projects.push('auth-backed');
    if (enabled(environment, 'CAPACITYLENS_WEBKIT')) projects.push('webkit');
    if (enabled(environment, 'CAPACITYLENS_FIREFOX')) projects.push('firefox');
  }

  return Object.freeze({
    projects: Object.freeze(projects),
    serverProfile: browserOnly ? 'workers' : 'standard',
  });
}
