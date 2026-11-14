// Metro transform worker for the mobile app: rebrands each module and locale catalog, then hands it
// to the worker Expo configured (mobile/metro.config.js records its path in the environment, which
// Metro's worker processes inherit). Metro has no plugin hook earlier than its transform worker.
const { createHash } = require('node:crypto')
const { readdirSync, readFileSync } = require('node:fs')
const path = require('node:path')

const UPSTREAM_WORKER_ENV = 'SEAL_METRO_UPSTREAM_TRANSFORM_WORKER'
const REPO_ROOT = path.resolve(__dirname, '../../..')
// Whatever changes the pass's output without changing the transformed file itself.
const PASS_INPUT_DIRS = [
  'config/seal/brand-copy',
  'mobile/src/i18n/seal-overrides',
  'src/renderer/src/i18n/seal-overrides'
]

function upstreamWorker() {
  const workerPath = process.env[UPSTREAM_WORKER_ENV]
  if (!workerPath) {
    throw new Error(`${UPSTREAM_WORKER_ENV} is unset; load Metro through mobile/metro.config.js.`)
  }
  return require(workerPath)
}

let brandPass = null
function loadBrandPass() {
  brandPass ??= import('./seal-brand-vite-plugin.mjs').then((module) =>
    module.createSealBrandPass(REPO_ROOT)
  )
  return brandPass
}

async function transform(config, projectRoot, filename, data, options) {
  const pass = await loadBrandPass()
  const file = path.resolve(projectRoot, filename)
  let branded = null
  if (pass.repoRelative(file) !== null) {
    const catalogPath = file.endsWith('.json') ? pass.catalogPath(file) : null
    branded = catalogPath
      ? pass.brandCatalogText(catalogPath, data.toString('utf8'))
      : pass.brandSource(file, data.toString('utf8'))
  }
  return upstreamWorker().transform(
    config,
    projectRoot,
    filename,
    branded === null ? data : Buffer.from(branded, 'utf8'),
    options
  )
}

function getCacheKey(config) {
  const hash = createHash('sha1').update(upstreamWorker().getCacheKey(config))
  for (const dir of PASS_INPUT_DIRS) {
    for (const name of readdirSync(path.join(REPO_ROOT, dir)).sort()) {
      hash.update(name).update(readFileSync(path.join(REPO_ROOT, dir, name)))
    }
  }
  return hash.digest('hex')
}

module.exports = { transform, getCacheKey }
