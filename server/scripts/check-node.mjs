// Preflight for every server entry script. The API uses Node's built-in `node:sqlite`, which
// needs Node 24+ (.nvmrc / engines). On an older Node the real failure is a link-time
// "No such built-in module: node:sqlite" thrown from deep inside tsx BEFORE any of our code
// runs (module resolution precedes evaluation, so an in-file guard can never fire) — this
// check runs as its own process first, so the error names the fix instead of the symptom.
const major = Number(process.versions.node.split('.')[0])
if (!Number.isInteger(major) || major < 24) {
  console.error(
    `capacitylens-server needs Node 24+ — found ${process.versions.node}. The API uses the ` +
      `built-in node:sqlite module (stable from Node 24; see .nvmrc). Fix: run \`nvm use\` in ` +
      `the repo root, or install Node 24+ from https://nodejs.org. If you only want to try ` +
      `the app without the server, \`pnpm run dev:demo\` runs on older Node.`,
  )
  process.exit(1)
}
