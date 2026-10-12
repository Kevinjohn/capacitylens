import vine from '@vinejs/vine'
import { rejectUnknownFields } from '#validators/rules/unknown_fields'
import { APP_DATA_KEYS } from '@capacitylens/shared/types/entities'

const batchPut = vine
  .object({
    method: vine.literal('PUT'),
    table: vine.enum(APP_DATA_KEYS),
    id: vine.string(),
    row: vine.object({}).allowUnknownProperties(),
  })
  .use(rejectUnknownFields(['method', 'table', 'id', 'row']))

const batchDelete = vine
  .object({
    method: vine.literal('DELETE'),
    table: vine.enum(APP_DATA_KEYS),
    id: vine.string(),
    accountId: vine.string().optional(),
    updatedAt: vine.string().optional(),
  })
  .use(rejectUnknownFields(['method', 'table', 'id', 'accountId', 'updatedAt']))

const batchArchive = vine
  .object({
    method: vine.literal('ARCHIVE'),
    table: vine.enum(APP_DATA_KEYS),
    id: vine.string(),
    accountId: vine.string(),
    updatedAt: vine.string().optional(),
  })
  .use(rejectUnknownFields(['method', 'table', 'id', 'accountId', 'updatedAt']))

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

export const batchValidator = vine.compile(
  vine.object({ ops: vine.array(operation).maxLength(5000) }).use(rejectUnknownFields(['ops']))
)
