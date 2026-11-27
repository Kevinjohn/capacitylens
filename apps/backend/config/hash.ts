import { defineConfig, drivers } from '@adonisjs/core/hash'

const hashConfig = defineConfig({
  default: 'scrypt',

  list: {
    scrypt: drivers.scrypt({
      // The OWASP scrypt profile N=2^14, r=8, p=5, for a 16 MiB memory target.
      cost: 16384,
      blockSize: 8,
      parallelization: 5,
      maxMemory: 33554432,
    }),
  },
})

export default hashConfig

declare module '@adonisjs/core/types' {
  export interface HashersList extends InferHashers<typeof hashConfig> {}
}
