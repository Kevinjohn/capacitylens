import assert from 'node:assert/strict';
import test from 'node:test';
import { E2E_RUN_PRESETS, resolvePlaywrightRunMode } from './playwrightRunMode.mjs';
import { parseReportPhaseName } from './playwrightServerScope.ts';

test('server API calls use the claimed port lane despite an inherited API override', async () => {
  const previousPortLane = process.env.CAPACITYLENS_PORT_LANE;
  const previousApi = process.env.VITE_CAPACITYLENS_API;
  process.env.CAPACITYLENS_PORT_LANE = '3';
  process.env.VITE_CAPACITYLENS_API = 'http://localhost:9000';
  try {
    const { API, serverTarget } = await import('../../e2e/serverTestState.ts');
    assert.equal(API, 'http://localhost:10300');
    assert.equal(serverTarget(3, 1).api, 'http://localhost:10302');
    assert.match(serverTarget(3, 1).databasePath, /\.e2e-l3-w1\.db$/);
  } finally {
    if (previousPortLane === undefined) delete process.env.CAPACITYLENS_PORT_LANE;
    else process.env.CAPACITYLENS_PORT_LANE = previousPortLane;
    if (previousApi === undefined) delete process.env.VITE_CAPACITYLENS_API;
    else process.env.VITE_CAPACITYLENS_API = previousApi;
  }
});

for (const [name, preset] of Object.entries(E2E_RUN_PRESETS)) {
  test(`the ${name} preset keeps its projects and server profile aligned`, () => {
    const mode = resolvePlaywrightRunMode(preset.environment);
    assert.deepEqual(
      mode.projects,
      preset.projects.length > 0 ? preset.projects : ['chromium', 'auth-backed'],
    );
    assert.equal(mode.serverProfile, preset === E2E_RUN_PRESETS.standard ? 'standard' : 'workers');
  });
}

test('the run mode selects one engine and rejects contradictory browser modes', () => {
  assert.deepEqual(resolvePlaywrightRunMode({ CAPACITYLENS_WEBKIT_ONLY: '1' }), {
    projects: ['webkit'],
    serverProfile: 'workers',
  });
  assert.throws(
    () =>
      resolvePlaywrightRunMode({ CAPACITYLENS_WEBKIT_ONLY: '1', CAPACITYLENS_FIREFOX_ONLY: '1' }),
    /cannot be combined|mutually exclusive/,
  );
});

test('the report phase is non-empty and rejects lossy or traversal-shaped aliases', () => {
  assert.equal(parseReportPhaseName(undefined), 'default');
  assert.equal(parseReportPhaseName(''), 'default');
  assert.equal(parseReportPhaseName('chromium-server'), 'chromium-server');
  assert.throws(() => parseReportPhaseName('///'), /letters, numbers, underscores and hyphens/);
  assert.throws(
    () => parseReportPhaseName('webkit/1'),
    /letters, numbers, underscores and hyphens/,
  );
});
