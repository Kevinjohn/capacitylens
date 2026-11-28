import ace from '@adonisjs/core/services/ace'

/**
 * Give a suite a newly migrated database. Migrations are forward-only, so this wipes and re-runs
 * them like `migration:fresh`, which cannot skip schema-class generation.
 */
export async function freshDatabase() {
  for (const [name, args] of [
    ['db:wipe', ['--force']],
    ['migration:run', ['--force', '--compact-output', '--no-schema-generate']],
  ] as const) {
    const command = await ace.exec(name, [...args])
    if (command.exitCode) throw command.error ?? new Error(`"${name}" failed`)
  }
}
