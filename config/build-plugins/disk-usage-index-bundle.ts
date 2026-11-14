import { resolve } from 'node:path'
import { build } from 'esbuild'
import type { Plugin } from 'vite'
import { sealBrandCopyEsbuild } from '../seal/brand-copy/seal-brand-esbuild-plugin.mjs'

const ENTRY = 'src/main/machines/disk-index/disk-usage-index-entry.ts'
const OUTPUT_FILE = 'disk-usage-index-entry.js'
/** The oldest Node an SSH machine may run the program on. */
const TARGET = 'node20'

/** The program is copied to other machines as one file, so it may only require Node's own modules. */
export function assertSelfContainedNodeProgram(code: string): void {
  for (const match of code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    if (!match[1].startsWith('node:')) {
      throw new Error(
        `The disk-usage index program requires "${match[1]}"; it must stand alone on a machine that has only Node.`
      )
    }
  }
}

export async function bundleDiskUsageIndexProgram(): Promise<{ code: string; inputs: string[] }> {
  const result = await build({
    entryPoints: [resolve(ENTRY)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    charset: 'ascii',
    write: false,
    metafile: true,
    logLevel: 'silent',
    plugins: [sealBrandCopyEsbuild()]
  })
  const code = result.outputFiles[0]?.text
  if (!code) {
    throw new Error('The disk-usage index build produced no program.')
  }
  assertSelfContainedNodeProgram(code)
  return { code, inputs: Object.keys(result.metafile.inputs) }
}

/**
 * Why a separate build: as one more Rollup entry the program shares chunks with the main process
 * whenever both import the same module, and a file that needs its chunks cannot be copied alone.
 */
export function createDiskUsageIndexBundlePlugin(): Plugin {
  return {
    name: 'seal-disk-usage-index-bundle',
    async buildStart() {
      const { code, inputs } = await bundleDiskUsageIndexProgram()
      for (const input of inputs) {
        this.addWatchFile(resolve(input))
      }
      this.emitFile({ type: 'asset', fileName: OUTPUT_FILE, source: code })
    }
  }
}
