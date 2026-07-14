import { readFile, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'

const RAW_LIMIT = 525_000
const GZIP_LIMIT = 165_000
const index = await readFile(resolve('dist/index.html'), 'utf8')
const entryPath = index.match(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/)?.[1]
if (!entryPath) throw new Error('Bundle budget: dist/index.html has no module entry script.')

const file = resolve('dist', entryPath.replace(/^\//, ''))
const raw = (await stat(file)).size
const gzip = gzipSync(await readFile(file)).byteLength
console.log(`Bundle budget: ${entryPath} — ${raw} bytes raw, ${gzip} bytes gzip.`)

if (raw > RAW_LIMIT || gzip > GZIP_LIMIT) {
  throw new Error(
    `Bundle budget exceeded (limits: ${RAW_LIMIT} raw / ${GZIP_LIMIT} gzip; actual: ${raw} raw / ${gzip} gzip).`,
  )
}
