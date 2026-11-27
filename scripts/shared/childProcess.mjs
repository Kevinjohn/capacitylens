/** Build deterministic non-colour child output without inheriting contradictory controls. */
export function nonColourEnvironment(extra = {}, parent = process.env) {
  const env = { ...parent, ...extra }
  delete env.NO_COLOR
  env.FORCE_COLOR = '0'
  return env
}

/** Distinguish a test failure from a runner that could not start or was terminated. */
export function reportSpawnFailureAndResolveExitStatus(label, result, report = console.error) {
  if (result.error) {
    report(`${label} could not start: ${result.error.message}`)
    return 2
  }
  if (result.signal) {
    report(`${label} was terminated by ${result.signal}.`)
    return 2
  }
  if (result.status === null || result.status === undefined) {
    report(`${label} ended without an exit status.`)
    return 2
  }
  return result.status
}
