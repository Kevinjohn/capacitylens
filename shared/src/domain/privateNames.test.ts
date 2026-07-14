import { describe, expect, it } from 'vitest'
import { emptyAppData, type Client, type Project } from '../types/entities'
import {
  normalizeCodeName,
  nameForQuotedContext,
  quoteCodeName,
  redactPrivateName,
  redactPrivateNames,
} from './privateNames'

const meta = { accountId: 'a1', createdAt: 't', updatedAt: 't' }
const privateClient: Client = {
  ...meta,
  id: 'c1',
  name: 'Real Client',
  color: '#112233',
  isPrivate: true,
  codeName: 'Northstar',
}
const privateProject: Project = {
  ...meta,
  id: 'p1',
  name: 'Real Project',
  clientId: 'c1',
  color: '#445566',
  isPrivate: true,
  codeName: 'Aurora',
}

describe('private-name projection', () => {
  it('stores code names without user-supplied outer quotes and displays one consistent quote pair', () => {
    expect(normalizeCodeName('  “Northstar”  ')).toBe('Northstar')
    expect(quoteCodeName('"Northstar"')).toBe('"Northstar"')
    expect(nameForQuotedContext('"Northstar"')).toBe('Northstar')
  })

  it('redacts a private row without mutating it and removes the raw codeName field', () => {
    const redacted = redactPrivateName(privateClient)
    expect(redacted.name).toBe('"Northstar"')
    expect(redacted).not.toHaveProperty('codeName')
    expect(privateClient).toMatchObject({ name: 'Real Client', codeName: 'Northstar' })
  })

  it('redacts only clients and projects, leaving public names and all other tables untouched', () => {
    const publicClient = { ...privateClient, id: 'c2', name: 'Public Client', isPrivate: undefined, codeName: undefined }
    const data = {
      ...emptyAppData(),
      clients: [privateClient, publicClient],
      projects: [privateProject],
    }
    const visible = redactPrivateNames(data)
    expect(visible.clients.map((c) => c.name)).toEqual(['"Northstar"', 'Public Client'])
    expect(visible.projects[0].name).toBe('"Aurora"')
    expect(visible.accounts).toBe(data.accounts)
  })
})
