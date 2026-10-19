import { CommandResultSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'
import { isJsonValue, jsonColumn } from '#models/json_column'

export default class CommandResult extends CommandResultSchema {
  @column(jsonColumn('command_results', 'result', isJsonValue))
  declare result: unknown
}
