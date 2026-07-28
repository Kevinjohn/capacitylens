import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Existing measured modules awaiting focused tests. New entries require an explicit policy review;
 * never use a directory or glob here, because the purpose is to stop new zero-coverage files. */
export const ZERO_COVERAGE_ALLOWLIST = new Set([
  'shared/src/account/sessionPolicy.ts',
  'src/components/external/ExternalForm.tsx',
  'src/components/scheduler/SchedulerView.tsx',
  'src/components/ui/skeleton.tsx',
  'src/lib/tour.ts',
])

export function uncoveredExecutableFiles(
  lcov,
  allowlist = ZERO_COVERAGE_ALLOWLIST,
) {
  const failures = []
  let source = null
  let linesFound = 0
  let linesHit = 0

  const finish = () => {
    if (source && linesFound > 0 && linesHit === 0 && !allowlist.has(source)) {
      failures.push(source)
    }
    source = null
    linesFound = 0
    linesHit = 0
  }

  for (const line of lcov.split(/\r?\n/u)) {
    if (line.startsWith('SF:')) {
      finish()
      source = line.slice(3).replaceAll('\\', '/')
    } else if (line.startsWith('LF:')) {
      linesFound = Number.parseInt(line.slice(3), 10)
    } else if (line.startsWith('LH:')) {
      linesHit = Number.parseInt(line.slice(3), 10)
    } else if (line === 'end_of_record') {
      finish()
    }
  }
  finish()
  return failures.sort()
}

export function checkFileCoverage(path = 'coverage/lcov.info') {
  const lcov = readFileSync(resolve(path), 'utf8')
  const failures = uncoveredExecutableFiles(lcov)
  if (failures.length === 0) return
  throw new Error(
    `Coverage contains wholly untested executable modules:\n${failures.map((file) => `- ${file}`).join('\n')}`,
  )
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    checkFileCoverage(process.argv[2])
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
