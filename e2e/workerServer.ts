import { resolveLane } from '../scripts/ports.mjs';
import { startE2eWorkerServer } from '../scripts/e2eWorkerRuntime.mjs';
import { configureServerTarget, prepareServerTemplate, serverTarget } from './serverTestState';

/** The process handles and target owned by one Playwright worker slot. */
export type E2eWorkerServer = Awaited<ReturnType<typeof startE2eWorkerServer>>;

/** Start the real API and Vite proxy associated with this worker's stable parallel index. */
export async function startWorkerServer(parallelIndex: number): Promise<E2eWorkerServer> {
  const lane = resolveLane();
  const target = serverTarget(lane, parallelIndex);
  const runtime = await startE2eWorkerServer(target, lane, parallelIndex);
  try {
    configureServerTarget(target, runtime.assertDrained);
    await prepareServerTemplate(target);
    return runtime;
  } catch (error) {
    try {
      await runtime.stop();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Worker fixture setup and cleanup failed.', {
        cause: cleanupError,
      });
    }
    throw error;
  }
}
