import router from '@adonisjs/core/services/router'
import db from '@adonisjs/lucid/services/db'
import { EXPORT_SCHEMA_VERSION } from '@capacitylens/shared/types/entities'
router.get('/health/ready', async () => { await db.rawQuery('SELECT 1'); return { status: 'ok', exportSchemaVersion: EXPORT_SCHEMA_VERSION } })
