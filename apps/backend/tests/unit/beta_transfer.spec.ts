import { test } from '@japa/runner'
import { seed } from '@capacitylens/shared/data/seed'
import {
  buildBetaExport,
  parseBetaExport,
  prepareBetaImport,
  serializeBetaExport,
} from '@capacitylens/shared/data/betaTransfer'
import { transformState } from '#transformers/state_transformer'

function confidentialSource() {
  const source = seed()
  const client = source.clients.find((row) => row.accountId === 'a-studio' && !row.builtin)!
  client.name = 'Wayne Foundation confidential research'
  client.isPrivate = true
  client.codeName = 'Project Nightwing'
  const project = source.projects.find((row) => row.accountId === 'a-studio')!
  project.name = 'Gotham confidential research'
  project.isPrivate = true
  project.codeName = 'Project Oracle'
  source.timeOff.find((row) => row.accountId === 'a-studio')!.note = 'Confidential appointment'
  return { source, client, project }
}

test.group('Beta transfer confidentiality boundary', () => {
  test('owner projection preserves supported confidential content and stable IDs', ({ assert }) => {
    const source = transformState(confidentialSource().source, 'a-studio', 'owner')
    const document = buildBetaExport(source, { accountId: 'a-studio', completeness: 'full' })
    const prepared = prepareBetaImport(parseBetaExport(serializeBetaExport(document)), {
      accountId: 'a-studio',
      memberResourceLinks: [{ memberId: 'bruce-member', resourceId: source.resources[0]!.id }],
    })
    assert.deepEqual(prepared.data, source)
    assert.deepEqual(
      buildBetaExport(prepared.data, { accountId: 'a-studio', completeness: 'full' }),
      document
    )
  })

  test('non-owner export keeps the existing name and note projection and cannot replace data', ({
    assert,
  }) => {
    const { source, client: privateClient, project: privateProject } = confidentialSource()
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const projection = transformState(source, 'a-studio', role)
      const document = buildBetaExport(projection, {
        accountId: 'a-studio',
        completeness: 'redacted',
      })
      const serialized = serializeBetaExport(document)
      const parsed = parseBetaExport(serialized)
      assert.deepEqual(parsed.data, projection)
      assert.notInclude(serialized, privateClient.name)
      assert.notInclude(serialized, privateProject.name)
      if (role !== 'admin') assert.notInclude(serialized, 'Confidential appointment')
      assert.throws(
        () => prepareBetaImport(parsed, { accountId: 'a-studio', memberResourceLinks: [] }),
        /full/i
      )
    }
  })
})
