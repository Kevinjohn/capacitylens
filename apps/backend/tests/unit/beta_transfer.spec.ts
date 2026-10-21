import { test } from '@japa/runner'
import { seed } from '@capacitylens/shared/data/seed'
import {
  buildBetaExport,
  parseBetaExport,
  prepareBetaImport,
  serializeBetaExport,
} from '@capacitylens/shared/data/betaTransfer'
import { validateEntityRow } from '#validators/entities/index'
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

test.group('Beta transfer backend contract regressions', () => {
  test('redacted private names preserve supported code-name boundaries', ({ assert }) => {
    for (const length of [98, 99, 100]) {
      const { source, client, project } = confidentialSource()
      client.codeName = 'N'.repeat(length)
      project.codeName = 'O'.repeat(length)
      for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
        const projection = transformState(source, 'a-studio', role)
        const document = buildBetaExport(projection, {
          accountId: 'a-studio',
          completeness: role === 'owner' ? 'full' : 'redacted',
        })
        const parsed = parseBetaExport(serializeBetaExport(document))
        assert.deepEqual(parsed.data, projection)
        if (role !== 'owner') {
          assert.lengthOf(parsed.data.clients.find((row) => row.id === client.id)!.name, length + 2)
          assert.lengthOf(
            parsed.data.projects.find((row) => row.id === project.id)!.name,
            length + 2
          )
          assert.notInclude(serializeBetaExport(document), client.name)
          assert.notInclude(serializeBetaExport(document), project.name)
          assert.throws(
            () => prepareBetaImport(parsed, { accountId: 'a-studio', memberResourceLinks: [] }),
            /full/i
          )
        }
      }
    }
  })

  test('colours accepted by ordinary backend writes round-trip without changing their representation', async ({
    assert,
  }) => {
    for (const color of ['#5C34D4', ' #5c34d4 ']) {
      const source = transformState(seed(), 'a-studio', 'owner')
      const rows = [
        source.accounts[0]!,
        source.clients.find((row) => !row.builtin)!,
        source.projects[0]!,
        source.resources.find((row) => row.kind === 'person')!,
        source.disciplines[0]!,
      ]
      const keys = ['accounts', 'clients', 'projects', 'resources', 'disciplines'] as const
      for (const [index, row] of rows.entries()) {
        row.color = color
        const validated = await validateEntityRow(
          keys[index]!,
          row as unknown as Record<string, unknown>
        )
        assert.equal(validated.color, color)
      }
      const document = buildBetaExport(source, { accountId: 'a-studio', completeness: 'full' })
      const prepared = prepareBetaImport(parseBetaExport(serializeBetaExport(document)), {
        accountId: 'a-studio',
        memberResourceLinks: [],
      })
      assert.deepEqual(prepared.data, source)
    }
  })
})
