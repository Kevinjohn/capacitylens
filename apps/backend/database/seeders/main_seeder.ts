import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { replaceWithSeed } from '#services/state_repository'

export default class MainSeeder extends BaseSeeder {
  async run() {
    await replaceWithSeed()
  }
}
