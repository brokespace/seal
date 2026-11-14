const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const { spawnSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const TAG = '[verify-packaged-disk-index-program]'
const NO_DAEMON_EXIT_CODE = 3

// The path src/main/worker-threads/forked-child-entry-path.ts resolves in a packaged app. The main
// process reads the program from here and copies it to each machine, so a missing file means no
// machine ever gets a disk index, and nothing else in the app notices.
function assertPackagedDiskIndexProgramExists(resourcesDir) {
  const programPath = join(
    resourcesDir,
    'app.asar.unpacked',
    'out',
    'main',
    'disk-usage-index-entry.js'
  )
  if (!existsSync(programPath)) {
    throw new Error(
      `${TAG} missing ${programPath}: asarUnpack must keep out/main/disk-usage-index-entry.js outside app.asar`
    )
  }
  // The same refusal the main process makes before copying the program to a machine.
  if (/require\(["']\.{1,2}\//.test(readFileSync(programPath, 'utf8'))) {
    throw new Error(`${TAG} ${programPath} requires other files, so it cannot be copied alone`)
  }
  return programPath
}

function runProgram(runtime, programPath, args, home) {
  const result = spawnSync(runtime.program, [programPath, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ...runtime.env, HOME: home, SEAL_DISK_INDEX_DIR: join(home, 'index') }
  })
  if (result.error) {
    throw new Error(`${TAG} could not launch ${runtime.program}: ${result.error.message}`)
  }
  return result
}

/** The packaged app run as Node, which is how the desktop runs the program on its own computer. */
function packagedAppAsNode(executablePath) {
  return { program: executablePath, env: { ELECTRON_RUN_AS_NODE: '1' } }
}

// Runs the packaged program from its packaged place: `scan` loads every module and starts the
// walker threads from the same file, and `query` must report that no daemon is running.
// `runtimes` defaults to the packaging Node, which is what a machine reached over SSH runs it on.
function verifyPackagedDiskIndexProgramRuns(
  resourcesDir,
  runtimes = [{ program: process.execPath, env: {} }]
) {
  const programPath = assertPackagedDiskIndexProgramExists(resourcesDir)
  for (const runtime of runtimes) {
    const home = mkdtempSync(join(tmpdir(), 'seal-disk-index-check-'))
    try {
      const folder = join(home, 'folder')
      const scanned = join(folder, 'kept')
      mkdirSync(scanned, { recursive: true })
      writeFileSync(join(scanned, 'file.bin'), Buffer.alloc(4096, 1))
      const scan = runProgram(runtime, programPath, ['scan', folder], home)
      let summary = null
      try {
        summary = JSON.parse(scan.stdout.trim().split('\n').at(-1))
      } catch {
        // Reported below with what the program printed.
      }
      if (scan.status !== 0 || summary?.totalFiles !== 1) {
        throw new Error(
          `${TAG} the packaged program did not index a folder under ${runtime.program} ` +
            `(status ${scan.status}).\nstdout: ${scan.stdout}\nstderr: ${scan.stderr}`
        )
      }
      const request = Buffer.from(JSON.stringify({ op: 'status' })).toString('base64')
      const query = runProgram(runtime, programPath, ['query', request], home)
      if (query.status !== NO_DAEMON_EXIT_CODE) {
        throw new Error(
          `${TAG} a query with no daemon must exit ${NO_DAEMON_EXIT_CODE} under ${runtime.program}, ` +
            `got ${query.status}.\nstdout: ${query.stdout}\nstderr: ${query.stderr}`
        )
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }
  console.log(`${TAG} OK: the packaged disk index program runs from app.asar.unpacked`)
}

module.exports = {
  assertPackagedDiskIndexProgramExists,
  packagedAppAsNode,
  verifyPackagedDiskIndexProgramRuns
}
