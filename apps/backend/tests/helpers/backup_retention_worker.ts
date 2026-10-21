import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { parentPort, workerData } from 'node:worker_threads'

const { dir, currentFile, barrier } = workerData as {
  dir: string
  currentFile: string
  barrier: SharedArrayBuffer
}
const ready = new Int32Array(barrier)
const lstat = fs.lstatSync
let inspected = 0
// Both workers must finish identifying the same completed files before either prunes.
fs.lstatSync = ((...args: Parameters<typeof lstat>) => {
  const result = lstat(...args)
  if (++inspected === 2) {
    if (Atomics.add(ready, 0, 1) + 1 === 2) Atomics.notify(ready, 0)
    else if (Atomics.wait(ready, 0, 1, 5_000) === 'timed-out')
      throw new Error('Concurrent retention did not reach the shared snapshot list')
  }
  return result
}) as typeof lstat
syncBuiltinESMExports()
const { pruneSnapshots } = await import('../../app/services/backup/retention.js')
const warnings: string[] = []
const pruned = pruneSnapshots({
  dir,
  currentFile,
  keep: 1,
  database: null,
  log: (message) => warnings.push(message),
})
parentPort!.postMessage({ pruned, warnings })
