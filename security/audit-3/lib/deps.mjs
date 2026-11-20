// Resolves the attack scripts' dependencies from cloud/seal-relay/node_modules so this folder
// needs no package.json of its own. Run `pnpm install` in cloud/seal-relay first.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const RELAY_DIR = fileURLToPath(new URL('../../../cloud/seal-relay/', import.meta.url))

const require = createRequire(new URL('../../../cloud/seal-relay/package.json', import.meta.url))

export const WebSocket = require('ws')
export const nacl = require('tweetnacl')
export const jose = require('jose')
export const loadWrangler = () => require('wrangler')
