import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'

const root = resolve(process.argv[2])
const deployed = resolve(process.argv[3])
assert.equal(Number(process.versions.node.split('.')[0]), 24)
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch }))
async function run(command, args, cwd = root, expected = 0) {
 const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env })
 const code = await new Promise((resolve, reject) => { child.once('error',reject); child.once('exit',resolve) })
 console.log(`${command} ${args.join(' ')} exit=${code}`)
 assert.equal(code, expected)
}
await run('pnpm', ['--filter','@capacitylens/shared','build'])
await run('pnpm', ['--filter','@api-starter-kit/backend','build'])
await run('pnpm', ['--filter','@api-starter-kit/backend','deploy','--prod',deployed])
await cp(join(deployed,'build'), deployed, { recursive: true })
await rm(join(deployed,'build'), { recursive: true })
await mkdir(join(deployed,'tmp'), { recursive: true })
const config = await readFile(join(deployed,'pnpm-workspace.yaml'),'utf8')
assert.match(config,/better-sqlite3:\s*true/)
const appHtml = await readFile(join(deployed,'public/index.html'),'utf8')
assert.match(appHtml,/CapacityLens/)
await run('node',['--input-type=module','-e',"import { EXPORT_SCHEMA_VERSION } from '@capacitylens/shared/types/entities'; if (EXPORT_SCHEMA_VERSION!==23) process.exit(1); console.log('compiled shared package loaded', EXPORT_SCHEMA_VERSION)"],deployed)
const sharedFile = join(deployed,'node_modules/@capacitylens/shared/dist/types/entityKeys.js')
await rename(sharedFile,sharedFile+'.negative')
try { await run('node',['--input-type=module','-e',"await import('@capacitylens/shared/types/entities')"],deployed,1) }
finally { await rename(sharedFile+'.negative',sharedFile) }
const net = createServer()
await new Promise(resolve=>net.listen(0,'127.0.0.1',resolve))
const port=net.address().port
await new Promise(resolve=>net.close(resolve))
const server = spawn('node',['bin/server.js'], {cwd:deployed,stdio:'inherit',env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),APP_URL:`http://127.0.0.1:${port}`,LOG_LEVEL:'info',APP_KEY:randomBytes(32).toString('base64url'),SESSION_DRIVER:'cookie'}})
try {
 let ready
 const deadline=Date.now()+30000
 while(Date.now()<deadline) {
  try { ready=await fetch(`http://127.0.0.1:${port}/health/ready`); if(ready.ok) break } catch(error) { if(error.cause?.code!=='ECONNREFUSED') throw error }
  await new Promise(resolve=>setTimeout(resolve,100))
 }
 assert.ok(ready?.ok,'native package must reach readiness')
 assert.deepEqual(await ready.json(),{status:'ok',exportSchemaVersion:23})
 const html=await fetch(`http://127.0.0.1:${port}/index.html`)
 assert.equal(html.status,200)
 assert.equal(await html.text(),appHtml)
 console.log('native package readiness and SPA: PASS')
 await rename(join(deployed,'public/index.html'),join(deployed,'public/index.html.negative'))
 try { const missing=await fetch(`http://127.0.0.1:${port}/index.html`); assert.equal(missing.status,404); console.log('missing-SPA negative control: red as expected') }
 finally { await rename(join(deployed,'public/index.html.negative'),join(deployed,'public/index.html')) }
} finally {
 server.kill('SIGTERM')
 const code=await new Promise(resolve=>server.once('exit',resolve))
 assert.equal(code,0)
}
console.log('PROBE 4: PASS')
