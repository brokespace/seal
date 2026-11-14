#!/usr/bin/env node
/**
 * Benchmarks the disk-usage index walker against `du` and other disk tools on a synthetic tree.
 *
 *   node config/seal/disk-index-benchmark/disk-index-benchmark.mjs generate <dir> [--files 5000000]
 *   node config/seal/disk-index-benchmark/disk-index-benchmark.mjs run <dir> [--tools <dir>] [--cold]
 *
 * `--tools` names a folder holding gdu, dua, dust and pdu binaries; any that are missing are skipped.
 * `--cold` drops the page cache before each run (needs passwordless sudo); without it the tree is
 * read once first, so every tool is measured against a warm cache.
 */
import { closeSync, futimesSync, mkdirSync, openSync, utimesSync, writeSync } from 'node:fs'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isMainThread, Worker, workerData } from 'node:worker_threads'
import { build } from 'esbuild'
import { runProcess } from '@orca/process-host'

const ROOT = resolve(import.meta.dirname, '../../..')
const FANOUT = 16
const FILES_PER_FOLDER = 10
const GENERATOR_THREADS = 8
const OLD_MTIME_SECONDS = Math.floor(Date.now() / 1000) - 30 * 24 * 3600
const SMALL_FILE = Buffer.alloc(1024, 0x61)

function flag(args, name, fallback) {
  const at = args.indexOf(name)
  return at !== -1 ? args[at + 1] : fallback
}

/** One generator thread fills `<dir>/p<thread>` four levels deep, ten files to a leaf folder. */
function generateShare({ dir, thread, leafFolders }) {
  const perBranch = Math.max(1, Math.ceil(leafFolders / (FANOUT * FANOUT * FANOUT)))
  let made = 0
  for (let a = 0; a < FANOUT && made < leafFolders; a++) {
    for (let b = 0; b < FANOUT && made < leafFolders; b++) {
      for (let c = 0; c < FANOUT && made < leafFolders; c++) {
        for (let d = 0; d < perBranch && made < leafFolders; d++) {
          const folder = join(dir, `p${thread}`, `a${a}`, `b${b}`, `c${c}`, `d${d}`)
          mkdirSync(folder, { recursive: true })
          for (let file = 0; file < FILES_PER_FOLDER; file++) {
            const fd = openSync(join(folder, `file-${file}.dat`), 'w')
            // A third of the files hold data, so sizes are not all zero.
            if (file % 3 === 0) {
              writeSync(fd, SMALL_FILE)
            }
            // Old timestamps: a fresh tree would look "recently modified" everywhere.
            futimesSync(fd, OLD_MTIME_SECONDS, OLD_MTIME_SECONDS)
            closeSync(fd)
          }
          utimesSync(folder, OLD_MTIME_SECONDS, OLD_MTIME_SECONDS)
          made += 1
        }
      }
    }
  }
}

async function generate(dir, files) {
  const leafFolders = Math.ceil(files / FILES_PER_FOLDER / GENERATOR_THREADS)
  const started = Date.now()
  await Promise.all(
    Array.from(
      { length: GENERATOR_THREADS },
      (_, thread) =>
        new Promise((done, fail) => {
          const worker = new Worker(new URL(import.meta.url), {
            workerData: { dir, thread, leafFolders }
          })
          worker.once('error', fail)
          worker.once('exit', done)
        })
    )
  )
  console.log(
    `generated ~${leafFolders * GENERATOR_THREADS * FILES_PER_FOLDER} files in ${((Date.now() - started) / 1000).toFixed(1)}s`
  )
}

async function timed(label, program, args, env = {}) {
  const started = process.hrtime.bigint()
  const result = await runProcess({
    program,
    args,
    env: { ...process.env, ...env },
    timeoutMs: 3_600_000,
    maxOutputBytes: 64 * 1024 * 1024
  })
  const seconds = Number(process.hrtime.bigint() - started) / 1e9
  if (result.code !== 0) {
    console.error(`${label}: exit ${result.code} ${result.stderr.slice(-200)}`)
  }
  return { label, seconds, stdout: result.stdout }
}

async function dropCaches() {
  await runProcess({
    program: 'sudo',
    args: ['-n', 'sh', '-c', 'sync; echo 3 > /proc/sys/vm/drop_caches'],
    timeoutMs: 600_000
  })
}

/** Touches one leaf folder in every `every`, as a day's ordinary churn would. */
async function touchFolders(dir, every) {
  let touched = 0
  let seen = 0
  const now = new Date()
  for (const p of await readdir(dir)) {
    for (const a of await readdir(join(dir, p))) {
      for (const b of await readdir(join(dir, p, a))) {
        for (const c of await readdir(join(dir, p, a, b))) {
          for (const d of await readdir(join(dir, p, a, b, c))) {
            if (seen++ % every === 0) {
              const folder = join(dir, p, a, b, c, d)
              closeSync(openSync(join(folder, `new-${now.getTime()}.dat`), 'w'))
              touched += 1
            }
          }
        }
      }
    }
  }
  return touched
}

async function run(dir, toolsDir, cold) {
  const work = await mkdtemp(join(tmpdir(), 'seal-disk-index-bench-'))
  const entry = join(work, 'disk-usage-index-entry.cjs')
  await build({
    entryPoints: [join(ROOT, 'src/main/machines/disk-index/disk-usage-index-entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: entry,
    logLevel: 'silent'
  })
  const rows = []
  const measure = async (label, program, args, env) => {
    if (cold) {
      await dropCaches()
    }
    const result = await timed(label, program, args, env)
    rows.push(result)
    console.log(`${label.padEnd(44)} ${result.seconds.toFixed(2)}s`)
    return result
  }
  const index = { SEAL_DISK_INDEX_DIR: work }
  const scan = (label, extra) =>
    measure(label, process.execPath, [entry, 'scan', dir, ...extra], index)

  if (!cold) {
    // Whichever tool runs first would otherwise pay to fill the page cache for the rest.
    await timed('warm-up', 'du', ['-sx', dir])
  }
  await measure('du -sx', 'du', ['-sx', dir])
  for (const [label, name, args] of [
    ['gdu (non-interactive)', 'gdu', ['-n', '-p', '-s', dir]],
    ['dua', 'dua', ['aggregate', dir]],
    ['dust', 'dust', ['-d', '0', dir]],
    ['pdu', 'pdu', ['--max-depth', '1', dir]]
  ]) {
    if (toolsDir) {
      await measure(label, join(toolsDir, name), args).catch(() =>
        console.log(`${String(label)}: not available`)
      )
    }
  }
  const threads = [1, 2, 4, 8].filter((count) => count <= availableParallelism())
  for (const count of threads) {
    await scan(`seal full scan, ${count} walker(s)`, ['--full', '--walkers', String(count)])
  }
  const walkers = String(threads.at(-1))
  await scan('seal full scan (builds the stored index)', ['--full', '--walkers', walkers])
  await scan('seal incremental, nothing changed', ['--walkers', walkers])
  const touched = await touchFolders(dir, 100)
  await scan(`seal incremental, ${touched} folders changed`, ['--walkers', walkers])
  const last = JSON.parse(rows.at(-1).stdout)
  const indexBytes = (await stat(join(work, 'scan.bin'))).size
  console.log(
    `\ntree: ${last.totalFiles} files in ${last.nodeCount} folders, ${(last.totalBytes / 2 ** 30).toFixed(2)} GiB; ` +
      `last scan read ${last.foldersRead} folders and reused ${last.foldersReused}; ` +
      `index file ${(indexBytes / 2 ** 20).toFixed(1)} MiB`
  )
  await rm(work, { recursive: true, force: true })
}

if (!isMainThread) {
  generateShare(workerData)
} else {
  const [command, target, ...rest] = process.argv.slice(2)
  if (command === 'generate' && target) {
    await generate(resolve(target), Number(flag(rest, '--files', '5000000')))
  } else if (command === 'run' && target) {
    await run(resolve(target), flag(rest, '--tools', null), rest.includes('--cold'))
  } else {
    console.error(
      'usage: disk-index-benchmark.mjs (generate <dir> [--files N] | run <dir> [--tools <dir>] [--cold])'
    )
    process.exitCode = 2
  }
}
