import { createServer, type AddressInfo, type Socket } from 'node:net'
import { test } from '@japa/runner'
import { configProvider } from '@adonisjs/core'
import app from '@adonisjs/core/services/app'
import env from '#start/env'

type SmtpTransport = {
  send(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>
  close(): Promise<void>
}

test('configured SMTP delivery times out when a peer accepts but never greets', async ({
  assert,
}) => {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const keys = [
    'CAPACITYLENS_MAIL_HOST',
    'CAPACITYLENS_MAIL_PORT',
    'CAPACITYLENS_MAIL_USER',
    'CAPACITYLENS_MAIL_PASSWORD',
    'CAPACITYLENS_MAIL_FROM',
  ] as const
  const previousEnv = new Map(keys.map((key) => [key, env.get(key)]))
  const previousProcess = new Map(
    keys.map((key) => [key, { present: Object.hasOwn(process.env, key), value: process.env[key] }])
  )
  let transport: SmtpTransport | undefined
  try {
    env.set('CAPACITYLENS_MAIL_HOST', '127.0.0.1')
    env.set('CAPACITYLENS_MAIL_PORT', String((server.address() as AddressInfo).port))
    env.set('CAPACITYLENS_MAIL_USER', 'mailer')
    env.set('CAPACITYLENS_MAIL_PASSWORD', 'test-mail-password')
    env.set('CAPACITYLENS_MAIL_FROM', 'alfred@capacitylens.dev')
    const configUrl = new URL(`../../config/mail.ts?timeout-test=${Date.now()}`, import.meta.url)
    const module = await import(configUrl.href)
    const provider = module.default
    const config = await configProvider.resolve<{ mailers: { smtp: () => SmtpTransport } }>(
      app,
      provider
    )
    assert.isNotNull(config)
    transport = config!.mailers.smtp()
    const started = Date.now()
    await assert.rejects(() =>
      transport!.send({
        from: 'alfred@capacitylens.dev',
        to: 'bruce@capacitylens.dev',
        subject: 'Your invitation',
        text: 'Open this link.',
      })
    )
    assert.isBelow(Date.now() - started, 8_000)
    assert.isAtLeast(sockets.size, 1)
  } finally {
    try {
      for (const key of keys) {
        env.set(key, previousEnv.get(key) as never)
        const raw = previousProcess.get(key)!
        if (raw.present) process.env[key] = raw.value!
        else delete process.env[key]
      }
      for (const key of keys) {
        const raw = previousProcess.get(key)!
        assert.equal(env.get(key), previousEnv.get(key))
        assert.equal(Object.hasOwn(process.env, key), raw.present)
        assert.equal(process.env[key], raw.value)
      }
    } finally {
      try {
        await transport?.close()
      } finally {
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
      }
    }
  }
}).timeout(15_000)
