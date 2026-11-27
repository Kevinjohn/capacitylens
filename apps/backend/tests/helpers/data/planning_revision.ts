import db from '@adonisjs/lucid/services/db'
import { PlanningRevisionService } from '#services/planning_revision_service'

const planningRevisions = new PlanningRevisionService()

/** The planning revision a company is at now. */
export function readPlanningRevision(companyId = 'a-studio') {
  return db.transaction((trx) => planningRevisions.getPlanningRevision(trx, companyId))
}
