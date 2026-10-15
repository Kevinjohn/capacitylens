import type { AppDataKey } from '@capacitylens/shared/types/entities'

export interface SyncOrder {
  sessionId: string
  sequence: number
}

interface Target {
  table: AppDataKey
  id: string
}
export interface BatchPutOp extends Target {
  method: 'PUT'
  row: Record<string, unknown>
}
export interface BatchDeleteOp extends Target {
  method: 'DELETE'
  accountId?: string
  updatedAt?: string
}
export interface BatchArchiveOp extends Target {
  method: 'ARCHIVE'
  accountId: string
  updatedAt?: string
}
export type BatchOp = BatchPutOp | BatchDeleteOp | BatchArchiveOp

export interface BatchRevision {
  table: string
  id: string
  createdAt: string
  updatedAt: string
  rewrite?: true
}
