import app from '@adonisjs/core/services/app'
import { DisposableDemoService } from '#services/disposable_demo_service'

export const disposableDemo = await app.container.make(DisposableDemoService)

export const email = 'admin@admin.admin'
export const password = 'capacitylens-demo-2026'
