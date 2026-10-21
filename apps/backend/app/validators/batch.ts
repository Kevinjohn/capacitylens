import vine from '@vinejs/vine'
import { APP_DATA_KEYS } from '@capacitylens/shared/types/entities'

const batchPut = vine.object({
  method: vine.literal('PUT'),
  table: vine.enum(APP_DATA_KEYS),
  id: vine.string(),
  row: vine.object({}).allowUnknownProperties(),
})

const batchDelete = vine.object({
  method: vine.literal('DELETE'),
  table: vine.enum(APP_DATA_KEYS),
  id: vine.string(),
  accountId: vine.string().optional(),
  updatedAt: vine.string().optional(),
})

const batchArchive = vine.object({
  method: vine.literal('ARCHIVE'),
  table: vine.enum(APP_DATA_KEYS),
  id: vine.string(),
  accountId: vine.string(),
  updatedAt: vine.string().optional(),
})

const hasMethod = (value: unknown, method: string) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (value as { method?: unknown }).method === method

const operation = vine.union([
  vine.union.if((value) => hasMethod(value, 'PUT'), batchPut),
  vine.union.if((value) => hasMethod(value, 'DELETE'), batchDelete),
  vine.union.else(batchArchive),
])

export const batchValidator = vine.compile(vine.object({ ops: vine.array(operation) }))
