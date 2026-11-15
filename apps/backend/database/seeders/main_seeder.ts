import { BaseSeeder } from '@adonisjs/lucid/seeders';
import { insertSeed } from '#services/state_repository';

export default class MainSeeder extends BaseSeeder {
  static environment = ['development', 'test'];

  async run() {
    await insertSeed();
  }
}
