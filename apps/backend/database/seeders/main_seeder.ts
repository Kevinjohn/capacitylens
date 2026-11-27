import { BaseSeeder } from '@adonisjs/lucid/seeders'
import app from '@adonisjs/core/services/app'
import { SeedRowService } from '#services/seed_row_service'

/** Provides example data for Lucid to seed in development and test. */
export default class MainSeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    const seedRows = await app.container.make(SeedRowService)
    await seedRows.insertSeed()
  }
}
