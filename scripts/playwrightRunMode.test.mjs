import assert from 'node:assert/strict';
import test from 'node:test';

test('server API calls use the claimed lane despite an inherited API override', async () => {
  const previousLane = process.env.CAPACITYLENS_PORT_LANE;
  const previousApi = process.env.VITE_CAPACITYLENS_API;
  process.env.CAPACITYLENS_PORT_LANE = '3';
  process.env.VITE_CAPACITYLENS_API = 'http://localhost:9000';
  try {
    const { API, serverTarget } = await import('../e2e/serverTestState.ts');
    assert.equal(API, 'http://localhost:10300');
    assert.equal(serverTarget(3, 1).api, 'http://localhost:10302');
    assert.match(serverTarget(3, 1).databasePath, /\.e2e-l3-w1\.db$/);
  } finally {
    if (previousLane === undefined) delete process.env.CAPACITYLENS_PORT_LANE;
    else process.env.CAPACITYLENS_PORT_LANE = previousLane;
    if (previousApi === undefined) delete process.env.VITE_CAPACITYLENS_API;
    else process.env.VITE_CAPACITYLENS_API = previousApi;
  }
});
