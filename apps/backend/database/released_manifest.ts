export interface ReleasedMigration {
  name: string
  sha256: string
}

/** Parse the immutable migration inventory without accepting unknown fields or duplicate names. */
export function parseManifest(value: unknown): ReleasedMigration[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== 'migrations,version' ||
    (value as { version?: unknown }).version !== 1 ||
    !Array.isArray((value as { migrations?: unknown }).migrations)
  )
    throw new Error('Invalid released migration manifest')

  const entries = (value as { migrations: unknown[] }).migrations
  if (!entries.length) throw new Error('Released migration manifest is empty')
  let previous = ''
  for (const entry of entries) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join() !== 'name,sha256'
    )
      throw new Error('Invalid released migration manifest entry')
    const { name, sha256 } = entry as Record<string, unknown>
    if (
      typeof name !== 'string' ||
      !/^database\/migrations\/[a-zA-Z0-9_]+$/.test(name) ||
      name <= previous ||
      typeof sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(sha256)
    )
      throw new Error('Invalid released migration manifest entry')
    previous = name
  }
  return entries as ReleasedMigration[]
}
