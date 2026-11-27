import { createRequire } from 'node:module'

let armed = false
let releaseVerification = Promise.withResolvers()
let armedBeforeHandler = false
let releaseBeforeHandler = Promise.withResolvers()
const coreRequire = createRequire(import.meta.resolve('@adonisjs/core'))
const { Server } = coreRequire('@adonisjs/http-server')
const handle = Server.prototype.handle
Server.prototype.handle = async function (...args) {
  if (armedBeforeHandler) {
    armedBeforeHandler = false
    process.send?.({ type: 'entered-native-handler' })
    await releaseBeforeHandler.promise
  }
  return handle.apply(this, args)
}

process.on('message', async (message) => {
  if (message?.type === 'install') {
    const { default: hash } = await import('@adonisjs/core/services/hash')
    const verify = hash.verify
    hash.verify = async function (...args) {
      if (armed) {
        armed = false
        process.send?.({ type: 'entered-verification' })
        await releaseVerification.promise
      }
      return verify.apply(this, args)
    }
    process.send?.({ type: 'instrumented' })
  }
  if (message?.type === 'arm') armed = true
  if (message?.type === 'release') releaseVerification.resolve()
  if (message?.type === 'arm-before-handler') armedBeforeHandler = true
  if (message?.type === 'release-before-handler') releaseBeforeHandler.resolve()
})

await import('../bin/server.ts')
