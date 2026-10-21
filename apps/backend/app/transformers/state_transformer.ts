import type { AppData } from '@capacitylens/shared/types/entities'
import type { Role } from '@capacitylens/shared/account/types'
import { canSeeTimeOffNote } from '@capacitylens/shared/domain/access'
import { redactPrivateName } from '@capacitylens/shared/domain/privateNames'

export function transformState(data: AppData, accountId: string | undefined, role: Role): AppData {
  const scoped = <T extends { accountId: string }>(rows: T[]) =>
    accountId ? rows.filter((row) => row.accountId === accountId) : rows
  const clients = scoped(data.clients).map((row) =>
    role === 'owner' ? row : redactPrivateName(row)
  )
  const projects = scoped(data.projects).map((row) =>
    role === 'owner' ? row : redactPrivateName(row)
  )
  const allocations = scoped(data.allocations)
  const timeOff = scoped(data.timeOff).map((row) =>
    !canSeeTimeOffNote(role) && row.note !== undefined ? { ...row, note: null } : row
  )
  return {
    accounts: accountId ? data.accounts.filter((row) => row.id === accountId) : data.accounts,
    clients,
    disciplines: scoped(data.disciplines),
    projects,
    phases: scoped(data.phases),
    resources: scoped(data.resources),
    activities: scoped(data.activities),
    allocations: allocations as AppData['allocations'],
    timeOff: timeOff as AppData['timeOff'],
    closures: scoped(data.closures),
  }
}
