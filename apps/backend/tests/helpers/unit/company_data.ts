import { seed } from '@capacitylens/shared/data/seed'
import type { PlanningAccessGrant } from '#services/planning/access_grant'

/** The seed with a private client and project and a time-off note in `a-studio`. */
export function confidentialSource() {
  const source = seed()
  const client = source.clients.find((row) => row.companyId === 'a-studio' && !row.builtin)!
  client.name = 'Wayne Foundation confidential research'
  client.isPrivate = true
  client.codeName = 'Project Nightwing'
  const project = source.projects.find((row) => row.companyId === 'a-studio')!
  project.name = 'Gotham confidential research'
  project.isPrivate = true
  project.codeName = 'Project Oracle'
  source.timeOff.find((row) => row.companyId === 'a-studio')!.note = 'Confidential appointment'
  return { source, client, project }
}

// The read adds `displayName` to each client and project; the export leaves it out by design.
export function dropDisplayNames<T extends { clients: object[]; projects: object[] }>(state: T): T {
  const strip = <R extends object>(row: R): R => {
    const copy = { ...row } as R & { displayName?: string }
    delete copy.displayName
    return copy
  }
  return { ...state, clients: state.clients.map(strip), projects: state.projects.map(strip) }
}

// An Editor sees neither private names nor time-off notes.
export const editorGrant = {
  role: 'editor',
  canSeePrivateNames: false,
  canSeeTimeOffNote: false,
} as unknown as PlanningAccessGrant

/** A private row carrying a marked value in each named field. */
export const secretRow = (fields: readonly string[]) => ({
  id: 'row-1',
  companyId: 'a-gotham',
  isPrivate: true,
  ...Object.fromEntries(fields.map((field) => [field, `SECRET ${field}`])),
})
