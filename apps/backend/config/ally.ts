import { defineConfig, services } from '@adonisjs/ally'
import type { InferSocialProviders } from '@adonisjs/ally/types'
import env from '#start/env'

const publicUrl = env.get('CAPACITYLENS_PUBLIC_URL') || env.get('APP_URL')

const allyConfig = defineConfig({
  google: services.google({
    clientId: env.get('CAPACITYLENS_GOOGLE_CLIENT_ID') || '',
    clientSecret: env.get('CAPACITYLENS_GOOGLE_CLIENT_SECRET') || '',
    callbackUrl: new URL('/api/auth/callback/google', publicUrl).href,
  }),
})

export default allyConfig

declare module '@adonisjs/ally/types' {
  interface SocialProviders extends InferSocialProviders<typeof allyConfig> {}
}
