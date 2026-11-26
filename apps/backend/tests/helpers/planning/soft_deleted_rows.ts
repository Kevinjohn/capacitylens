import { beforeFetch, beforeFind } from '@adonisjs/lucid/orm';
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model';
import Discipline from '#models/discipline';

/** A discipline model whose own find and fetch hooks add an `OR` condition after the scope's. */
export class DisciplineWithLaterOrHooks extends Discipline {
  static table = 'disciplines';

  @beforeFind()
  static addFindOrCondition(query: ModelQueryBuilderContract<typeof DisciplineWithLaterOrHooks>) {
    void query.orWhere('name', 'Wayne Foundation');
  }

  @beforeFetch()
  static addFetchOrCondition(query: ModelQueryBuilderContract<typeof DisciplineWithLaterOrHooks>) {
    void query.orWhere('name', 'Wayne Foundation');
  }
}
