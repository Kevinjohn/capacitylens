import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { insertSeed } from '#services/state_repository'

export default class MainSeeder extends BaseSeeder {
  async run() {
    await insertSeed()
  }
}
