import type { HttpContext } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'
import {
  readPlanning,
  mutatePlanning,
  lookupPlanningMutation,
  validatePlanningMutationId,
} from '#services/planning'
import { BatchRequestError } from '#services/planning_operations/errors'
import { PlanningOperationError } from '#services/planning_operations/execute'
import { SessionAuthorityError } from '#services/auth/session_authority'
import { IdentityAuthorityError } from '#services/auth/authorization'
import {
  allocationMutationValidator,
  catalogueMutationValidator,
  resourceMutationValidator,
  timeOffMutationValidator,
  closureMutationValidator,
  settingsMutationValidator,
  planningMutationValidator,
  planningMutationErrorCodes,
  StalePlanningRevisionError,
} from '#validators/planning_operations'
import type {
  PlanningMutationInput,
  PlanningMutationFailure,
} from '#validators/planning_operations'

function refusal(error: unknown): { status: number; body: PlanningMutationFailure } {
  if (error instanceof PlanningOperationError) {
    const code =
      planningMutationErrorCodes.find((candidate) => candidate === error.code) ??
      (error.status === 400
        ? 'validation_error'
        : error.status === 403
          ? 'authorization_denied'
          : undefined)
    const status = code === 'validation_error' ? 400 : error.status
    return { status, body: { error: error.message, ...(code ? { code } : {}) } }
  }
  if (error instanceof BatchRequestError)
    return {
      status: error.status === 403 ? 403 : 400,
      body: {
        error: error.message,
        code: error.status === 403 ? 'authorization_denied' : 'validation_error',
      },
    }
  if (error instanceof StalePlanningRevisionError)
    return { status: 409, body: { error: error.message, code: 'stale_revision' } }
  if (error instanceof vineErrors.E_VALIDATION_ERROR)
    return {
      status: 400,
      body: {
        error: error.messages[0]?.message ?? 'Invalid planning input.',
        code: 'validation_error',
      },
    }
  if (error instanceof SessionAuthorityError)
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.status === 401 ? 'unauthenticated' : 'authorization_denied',
      },
    }
  // Identity resolution failures invalidate the projection; action refusals use PlanningOperationError.
  if (error instanceof IdentityAuthorityError)
    return {
      status: 403,
      body: { error: 'Planning access is unavailable.', code: 'account_membership_lost' },
    }
  throw error
}

/** Resource routes accept only their named operation and matching target; the body never selects a table. */
export default class PlanningController {
  async show(ctx: HttpContext) {
    try {
      return await readPlanning(ctx, String(ctx.params.accountId))
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async lookup(ctx: HttpContext) {
    try {
      const mutationId = await validatePlanningMutationId(ctx.params.mutationId)
      return await lookupPlanningMutation(ctx, String(ctx.params.accountId), mutationId)
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  private async execute(
    ctx: HttpContext,
    input: PlanningMutationInput,
    operation: PlanningMutationInput['intent']['operation'],
    entity?: string
  ) {
    try {
      if (input.intent.operation !== operation)
        throw new PlanningOperationError(
          400,
          'validation_error',
          'The operation does not match this resource route.'
        )
      const target = 'entity' in input.intent ? input.intent.entity : input.intent
      if (entity && (!('entity' in target) || target.entity !== entity))
        throw new PlanningOperationError(
          400,
          'validation_error',
          'The operation does not match this resource route.'
        )
      const targetId =
        'sourceAllocationId' in target
          ? target.sourceAllocationId
          : 'id' in target
            ? target.id
            : undefined
      if (ctx.params.id !== undefined && targetId !== ctx.params.id)
        throw new PlanningOperationError(
          400,
          'validation_error',
          'The operation target does not match this resource route.'
        )
      return await mutatePlanning(ctx, String(ctx.params.accountId), input)
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async allocationCreate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(allocationMutationValidator)
      return await this.execute(ctx, input, 'allocation.create')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async allocationUpdate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(allocationMutationValidator)
      return await this.execute(ctx, input, 'allocation.update')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async allocationDuplicate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(allocationMutationValidator)
      return await this.execute(ctx, input, 'allocation.duplicate')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async allocationRepeat(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(allocationMutationValidator)
      return await this.execute(ctx, input, 'allocation.repeat')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async allocationCreateGroup(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(allocationMutationValidator)
      return await this.execute(ctx, input, 'allocation.createGroup')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async allocationDelete(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(allocationMutationValidator)
      return await this.execute(ctx, input, 'allocation.delete')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async allocationDeleteGroup(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(allocationMutationValidator)
      return await this.execute(ctx, input, 'allocation.deleteGroup')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async restoreGroup(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(planningMutationValidator)
      return await this.execute(ctx, input, 'planning.restoreGroup')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async resourceCreate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(resourceMutationValidator)
      return await this.execute(ctx, input, 'resource.create')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async resourceUpdate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(resourceMutationValidator)
      return await this.execute(ctx, input, 'resource.update')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async timeOffCreate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(timeOffMutationValidator)
      return await this.execute(ctx, input, 'timeOff.create')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async timeOffUpdate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(timeOffMutationValidator)
      return await this.execute(ctx, input, 'timeOff.update')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async timeOffDelete(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(timeOffMutationValidator)
      return await this.execute(ctx, input, 'timeOff.delete')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async timeOffDeleteGroup(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(timeOffMutationValidator)
      return await this.execute(ctx, input, 'timeOff.deleteGroup')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async timeOffRepeat(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(timeOffMutationValidator)
      return await this.execute(ctx, input, 'timeOff.repeat')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async closureCreate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(closureMutationValidator)
      return await this.execute(ctx, input, 'closure.create')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async closureUpdate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(closureMutationValidator)
      return await this.execute(ctx, input, 'closure.update')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async closureDelete(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(closureMutationValidator)
      return await this.execute(ctx, input, 'closure.delete')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async settingsUpdate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(settingsMutationValidator)
      return await this.execute(ctx, input, 'settings.update')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async clientCreate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.create', 'clients')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async clientUpdate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.update', 'clients')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async clientArchive(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.archive', 'clients')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async clientUnarchive(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.unarchive', 'clients')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async projectCreate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.create', 'projects')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async projectUpdate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.update', 'projects')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async projectArchive(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.archive', 'projects')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async projectUnarchive(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.unarchive', 'projects')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async activityCreate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.create', 'activities')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async activityUpdate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.update', 'activities')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async activityArchive(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.archive', 'activities')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async activityUnarchive(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.unarchive', 'activities')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async phaseCreate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.create', 'phases')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async phaseUpdate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.update', 'phases')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async phaseDelete(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.delete', 'phases')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async disciplineCreate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.create', 'disciplines')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async disciplineUpdate(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.update', 'disciplines')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async disciplineDelete(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(catalogueMutationValidator)
      return await this.execute(ctx, input, 'catalogue.delete', 'disciplines')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async resourceArchive(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(resourceMutationValidator)
      return await this.execute(ctx, input, 'resource.archive')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }

  async resourceUnarchive(ctx: HttpContext) {
    try {
      const input = await ctx.request.validateUsing(resourceMutationValidator)
      return await this.execute(ctx, input, 'resource.unarchive')
    } catch (error) {
      const failure = refusal(error)
      return ctx.response.status(failure.status).send(failure.body)
    }
  }
}
