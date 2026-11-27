import { APP_DATA_KEYS } from '../types/entityKeys.js'
import type { AppData } from '../types/entities.js'
import { isRecord } from '../lib/isRecord.js'
import { fail, hasOwn } from './companyExport.errors.js'
import { FIELDS } from './companyExport.fields.js'
import type { Row } from './companyExport.fields.js'

/** Copy only the named portable fields for one already scoped company. */
export function projectCompanyData(data: AppData, companyId: string): AppData {
  const projected = {} as AppData
  for (const key of APP_DATA_KEYS) {
    const source = data[key] as unknown[]
    if (!Array.isArray(source)) fail(`data.${key}`, 'must be a list')
    const selected =
      key === 'companies'
        ? source.filter((row): row is Row => isRecord(row) && row.id === companyId)
        : source.filter((row): row is Row => isRecord(row) && row.companyId === companyId)
    ;(projected as unknown as Record<string, unknown>)[key] = selected.map((input) => {
      const copy: Row = {}
      for (const field of FIELDS[key]) {
        if (hasOwn(input, field)) {
          const fieldValue = input[field]
          copy[field] = Array.isArray(fieldValue)
            ? (fieldValue as unknown[]).map((item: unknown) => item)
            : fieldValue
        }
      }
      return copy
    })
  }
  return projected
}
