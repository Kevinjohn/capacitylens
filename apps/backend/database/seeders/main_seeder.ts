import { BaseSeeder } from '@adonisjs/lucid/seeders';
import { insertSeed } from '#services/fixture_seed';

/** Provides sample data for Lucid to seed in development and test. */
export default class MainSeeder extends BaseSeeder {
  static environment = ['development', 'test'];

  async run() {
    await insertSeed();
  }
}
