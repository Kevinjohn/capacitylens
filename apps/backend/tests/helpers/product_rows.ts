import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { LucidModel } from '@adonisjs/lucid/types/model'
import type { AppDataKey } from '@capacitylens/shared/types/entities'
import { productModels } from '#services/models/product_models'
import { rowAttributes } from '#services/models/row_attributes'
import { ActivityFactory } from '#database/factories/activity_factory'
import { AllocationFactory } from '#database/factories/allocation_factory'
import { ClientFactory } from '#database/factories/client_factory'
import { ClosureFactory } from '#database/factories/closure_factory'
import { CompanyFactory } from '#database/factories/company_factory'
import { DisciplineFactory } from '#database/factories/discipline_factory'
import { PhaseFactory } from '#database/factories/phase_factory'
import { ProjectFactory } from '#database/factories/project_factory'
import { ResourceFactory } from '#database/factories/resource_factory'
import { TimeOffFactory } from '#database/factories/time_off_factory'

/** The part of a Lucid factory builder this helper drives, shared by every product factory. */
interface ProductFactory {
  merge(attributes: object[]): ProductFactory
  client(client: QueryClientContract): ProductFactory
  createMany(count: number): Promise<unknown>
}

const productFactories = {
  companies: CompanyFactory,
  clients: ClientFactory,
  disciplines: DisciplineFactory,
  projects: ProjectFactory,
  phases: PhaseFactory,
  resources: ResourceFactory,
  activities: ActivityFactory,
  allocations: AllocationFactory,
  timeOff: TimeOffFactory,
  closures: ClosureFactory,
} satisfies Record<AppDataKey, unknown>

/**
 * Stores product rows of one table through its model factory. Each row is merged whole, a
 * missing column as null, so no factory default replaces a value the row leaves out. Without a
 * client the model's default connection is used.
 */
export async function insertProductRows(
  key: AppDataKey,
  rows: readonly object[],
  client?: QueryClientContract
) {
  if (rows.length === 0) return
  const model: LucidModel = productModels[key]
  const builder = (productFactories[key] as unknown as ProductFactory).merge(
    rows.map((row) => rowAttributes(model, row))
  )
  await (client ? builder.client(client) : builder).createMany(rows.length)
}
