// esbuild adapter for the Seal brand pass (orcad server bundles, WSL guest programs).
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import { REPO_ROOT, createSealBrandPass } from './seal-brand-vite-plugin.mjs'

const LOADERS = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx'
}

/** @returns {import('esbuild').Plugin} */
export function sealBrandCopyEsbuild({ root = REPO_ROOT } = {}) {
  const pass = createSealBrandPass(root)
  return {
    name: 'seal-brand-copy',
    setup(build) {
      build.onLoad({ filter: /\.(?:[cm]?[jt]s|[jt]sx|json)$/ }, async (args) => {
        if (args.namespace !== 'file' || pass.repoRelative(args.path) === null) {
          return undefined
        }
        if (args.path.endsWith('.json')) {
          const catalogPath = pass.catalogPath(args.path)
          return catalogPath
            ? {
                contents: pass.brandCatalogText(catalogPath, await readFile(args.path, 'utf8')),
                loader: 'json'
              }
            : undefined
        }
        const branded = pass.brandSource(args.path, await readFile(args.path, 'utf8'))
        return branded === null
          ? undefined
          : { contents: branded, loader: LOADERS[extname(args.path)] }
      })
    }
  }
}
