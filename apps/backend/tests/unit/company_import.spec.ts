import { test } from '@japa/runner'
import { seed } from '@capacitylens/shared/data/seed'
import {
  buildCompanyExport,
  parseCompanyExport,
  prepareCompanyImport,
  serializeCompanyExport,
} from '@capacitylens/shared/data/companyExport'
import { RowValidationService } from '#services/planning/row_validation_service'
import { transformState } from '#transformers/state_transformer'
import { confidentialSource, dropDisplayNames } from '#tests/helpers/unit/company_data'

const rowValidation = new RowValidationService()

test.group('company import confidentiality boundary', () => {
  test('owner projection preserves supported confidential content and stable IDs', ({ assert }) => {
    const source = transformState(confidentialSource().source, 'a-studio', 'owner')
    const document = buildCompanyExport(source, { companyId: 'a-studio', completeness: 'full' })
    const prepared = prepareCompanyImport(parseCompanyExport(serializeCompanyExport(document)), {
      companyId: 'a-studio',
      memberResourceLinks: [{ memberId: 'bruce-member', resourceId: source.resources[0]!.id }],
    })
    assert.deepEqual(prepared.data, dropDisplayNames(source))
    assert.deepEqual(
      buildCompanyExport(prepared.data, { companyId: 'a-studio', completeness: 'full' }),
      document
    )
  })

  test('non-owner export keeps the existing name and note projection and cannot replace data', ({
    assert,
  }) => {
    const { source, client: privateClient, project: privateProject } = confidentialSource()
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const projection = transformState(source, 'a-studio', role)
      const document = buildCompanyExport(projection, {
        companyId: 'a-studio',
        completeness: 'redacted',
      })
      const serialized = serializeCompanyExport(document)
      const parsed = parseCompanyExport(serialized)
      assert.deepEqual(parsed.data, dropDisplayNames(projection))
      assert.notInclude(serialized, privateClient.name)
      assert.notInclude(serialized, privateProject.name)
      if (role !== 'admin') assert.notInclude(serialized, 'Confidential appointment')
      assert.throws(
        () => prepareCompanyImport(parsed, { companyId: 'a-studio', memberResourceLinks: [] }),
        /full/i
      )
    }
  })
})

test.group('company import contract regressions', () => {
  test('redacted private names preserve supported code-name boundaries', ({ assert }) => {
    for (const length of [98, 99, 100]) {
      const { source, client, project } = confidentialSource()
      client.codeName = 'N'.repeat(length)
      project.codeName = 'O'.repeat(length)
      for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
        const projection = transformState(source, 'a-studio', role)
        const document = buildCompanyExport(projection, {
          companyId: 'a-studio',
          completeness: role === 'owner' ? 'full' : 'redacted',
        })
        const parsed = parseCompanyExport(serializeCompanyExport(document))
        assert.deepEqual(parsed.data, dropDisplayNames(projection))
        if (role !== 'owner') {
          assert.lengthOf(parsed.data.clients.find((row) => row.id === client.id)!.name, length + 2)
          assert.lengthOf(
            parsed.data.projects.find((row) => row.id === project.id)!.name,
            length + 2
          )
          assert.notInclude(serializeCompanyExport(document), client.name)
          assert.notInclude(serializeCompanyExport(document), project.name)
          assert.throws(
            () => prepareCompanyImport(parsed, { companyId: 'a-studio', memberResourceLinks: [] }),
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
        source.companies[0]!,
        source.clients.find((row) => !row.builtin)!,
        source.projects[0]!,
        source.resources.find((row) => row.kind === 'person')!,
        source.disciplines[0]!,
      ]
      const keys = ['companies', 'clients', 'projects', 'resources', 'disciplines'] as const
      for (const [index, row] of rows.entries()) {
        row.color = color
        const validated = await rowValidation.validateRow(
          keys[index]!,
          row as unknown as Record<string, unknown>
        )
        assert.equal(validated.color, color)
      }
      const document = buildCompanyExport(source, { companyId: 'a-studio', completeness: 'full' })
      const prepared = prepareCompanyImport(parseCompanyExport(serializeCompanyExport(document)), {
        companyId: 'a-studio',
        memberResourceLinks: [],
      })
      assert.deepEqual(prepared.data, dropDisplayNames(source))
    }
  })
})
