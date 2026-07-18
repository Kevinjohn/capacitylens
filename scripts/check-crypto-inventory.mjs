import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const inventoryPath = 'docs/security/crypto-inventory.json'
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
const reviewed = new Set(inventory.entries.map((entry) => entry.path))

const listed = spawnSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
if (listed.status !== 0) {
  console.error(listed.stderr || 'Unable to enumerate repository files for cryptographic discovery.')
  process.exit(1)
}

const excluded = /(?:^|\/)(?:node_modules|reports|coverage|dist|src\/paraglide|to-my-siblings)(?:\/|$)|(?:\.test|\.spec)\.[cm]?[jt]sx?$|^scripts\/check-crypto-inventory\.mjs$/
const eligible = /(?:\.[cm]?[jt]sx?|\.mjs|\.sh|\.conf)$/
const markers = [
  /(?:from|require\()['"]node:crypto/,
  /from\s+['"]jose['"]/,
  /\bcrypto\.(?:subtle|randomUUID|getRandomValues)\s*\(?/,
  /\b(?:AES-GCM|scrypt|timingSafeEqual|createHash|createHmac|randomBytes)\b/,
  /\bopenssl\b/,
  /\bproxy_ssl_(?:verify|trusted_certificate|protocols|name)\b/,
  /CAPACITYLENS_INTERNAL_TLS_(?:CERT|KEY|CA)/,
  /\bloadInternalTls\s*\(/,
  /minVersion:\s*['"]TLSv/,
]

const discovered = new Set()
for (const path of listed.stdout.split('\n').filter(Boolean)) {
  if (excluded.test(path) || !(eligible.test(path) || path === 'Dockerfile')) continue
  const source = readFileSync(path, 'utf8')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  if (markers.some((marker) => marker.test(source))) discovered.add(path)
}

const unreviewed = [...discovered].filter((path) => !reviewed.has(path)).sort()
const stale = [...reviewed].filter((path) => !discovered.has(path)).sort()
if (unreviewed.length > 0 || stale.length > 0) {
  if (unreviewed.length > 0) {
    console.error(`Unreviewed cryptographic implementation paths:\n  ${unreviewed.join('\n  ')}`)
  }
  if (stale.length > 0) {
    console.error(`Stale cryptographic inventory paths:\n  ${stale.join('\n  ')}`)
  }
  console.error(`Update ${inventoryPath} after reviewing the algorithms, keys, purpose and lifecycle.`)
  process.exit(1)
}

console.log(`Cryptographic discovery: ${discovered.size} implementation paths match the reviewed inventory.`)
