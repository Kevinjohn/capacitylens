const supportedRange = 'Node >=24.19.0 <25 or >=26.9.0 <27'

/** Preserve the supported native-server runtime range at every deployed entry point. */
export function supportsNodeVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return (major === 24 && minor >= 19) || (major === 26 && minor >= 9)
}

/** Refuse unsupported Node before importing providers or opening application data. */
export function assertSupportedNodeVersion(version = process.versions.node) {
  if (!supportsNodeVersion(version))
    throw new Error(
      `CapacityLens requires ${supportedRange}; found Node ${version}. Use nvm use for the default Node 24 runtime.`
    )
}
