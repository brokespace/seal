import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomically } from '../../filesystem/atomic-file-publication'
import { isRecord } from '../home-chat-record-guard'
import type { HomeChatMachineProvider } from '../machines/home-chat-machine-types'
import {
  jobKillScript,
  jobLaunchScript,
  jobOutputRangeScript,
  jobRemoveScript,
  jobStatusScript,
  jobWatchScript,
  parseJobReport,
  type JobReport
} from './home-chat-job-scripts'

export type HomeChatJobState = 'running' | 'exited' | 'killed' | 'lost'

export type HomeChatJob = {
  id: string
  chatId: string
  machine: string
  machineLabel: string
  command: string
  cwd?: string
  startedAt: number
  state: HomeChatJobState
  exitCode?: number | null
  endedAt?: number
}

export type HomeChatJobRunResult =
  | {
      kind: 'finished'
      exitCode: number | null
      output: string
      totalBytes: number
      machineLabel: string
      /** Set when the log is longer than `output`: the job is kept so the rest can be read. */
      jobId?: string
    }
  | { kind: 'background'; job: HomeChatJob; output: string; totalBytes: number }

export type HomeChatJobRegistryDeps = {
  rootDir: string
  machines: HomeChatMachineProvider
  /** A background job ended; tell its chat. */
  onJobEnded: (job: HomeChatJob, outputTail: string) => void
}

const TAIL_BYTES = 30_000
const NOTICE_TAIL_BYTES = 3_000
const WATCH_TIMEOUT_MS = 6 * 60 * 60_000
const WATCH_RETRY_MS = 30_000
const MAX_KEPT_JOBS = 200

function isJob(value: unknown): value is HomeChatJob {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.chatId === 'string' &&
    typeof value.machine === 'string'
  )
}

/** Long-running commands on any machine: they keep running when the turn or the app ends. */
export class HomeChatJobRegistry {
  private readonly jobs = new Map<string, HomeChatJob>()
  private readonly watchers = new Map<string, AbortController>()
  private readonly path: string
  private disposed = false

  constructor(private readonly deps: HomeChatJobRegistryDeps) {
    this.path = join(deps.rootDir, 'jobs.json')
  }

  /** Load saved jobs and re-attach a watcher to each one still running. */
  async load(): Promise<void> {
    const raw: unknown = await readFile(this.path, 'utf8')
      .then((text): unknown => JSON.parse(text))
      .catch(() => [])
    for (const job of Array.isArray(raw) ? raw.filter(isJob) : []) {
      this.jobs.set(job.id, job)
    }
    for (const job of this.jobs.values()) {
      if (job.state === 'running') {
        this.watch(job)
      }
    }
  }

  /** Run a command; whatever outlasts waitSeconds keeps running as a background job. */
  async run(args: {
    chatId: string
    machine: string
    command: string
    cwd?: string
    waitSeconds: number
    signal?: AbortSignal
  }): Promise<HomeChatJobRunResult> {
    const machine = await this.deps.machines.open(args.machine)
    const id = randomUUID().slice(0, 8)
    const result = await machine.exec(
      jobLaunchScript(machine.dialect, {
        jobId: id,
        command: args.command,
        cwd: args.cwd,
        waitSeconds: args.waitSeconds,
        tailBytes: TAIL_BYTES,
        removeWhenFinished: true
      }),
      { timeoutMs: (args.waitSeconds + 60) * 1000, signal: args.signal }
    )
    if (args.signal?.aborted) {
      await machine.exec(jobKillScript(machine.dialect, id), { timeoutMs: 30_000 }).catch(() => {})
      throw new Error('Stopped by the user; the command was killed.')
    }
    const report = parseLaunchResult(result)
    const job: HomeChatJob = {
      id,
      chatId: args.chatId,
      machine: machine.info.id,
      machineLabel: machine.info.label,
      command: args.command,
      ...(args.cwd ? { cwd: args.cwd } : {}),
      startedAt: Date.now(),
      state: 'running'
    }
    if (report.state === 'exited') {
      const kept = report.totalBytes > TAIL_BYTES
      if (kept) {
        this.jobs.set(id, {
          ...job,
          state: 'exited',
          exitCode: report.exitCode,
          endedAt: Date.now()
        })
        this.save()
      }
      return {
        kind: 'finished',
        exitCode: report.exitCode,
        output: report.output,
        totalBytes: report.totalBytes,
        machineLabel: machine.info.label,
        ...(kept ? { jobId: id } : {})
      }
    }
    if (report.state !== 'running') {
      throw new Error('The command did not start; check the working directory and machine.')
    }
    this.jobs.set(id, job)
    this.save()
    this.watch(job)
    return { kind: 'background', job, output: report.output, totalBytes: report.totalBytes }
  }

  list(chatId: string): HomeChatJob[] {
    return [...this.jobs.values()].filter((job) => job.chatId === chatId)
  }

  get(jobId: string): HomeChatJob {
    const job = this.jobs.get(jobId.trim())
    if (!job) {
      throw new Error(`No job ${jobId}. Call job_status without an id to list jobs.`)
    }
    return job
  }

  async status(jobId: string): Promise<{ job: HomeChatJob; report: JobReport }> {
    const job = this.get(jobId)
    const machine = await this.deps.machines.open(job.machine)
    const result = await machine.exec(jobStatusScript(machine.dialect, job.id, 2_000), {
      timeoutMs: 30_000
    })
    const report = parseJobReport(result.stdout)
    this.settle(job, report)
    return { job, report }
  }

  /** Bytes of the job's log: the tail by default, or a range from offset. */
  async output(jobId: string, range: { offset?: number; length: number }): Promise<string> {
    const job = this.get(jobId)
    const machine = await this.deps.machines.open(job.machine)
    if (range.offset === undefined) {
      const report = parseJobReport(
        (
          await machine.exec(jobStatusScript(machine.dialect, job.id, range.length), {
            timeoutMs: 60_000
          })
        ).stdout
      )
      if (report.state === 'missing') {
        throw new Error(`Job ${job.id}'s log is gone from ${job.machineLabel}.`)
      }
      return `[${report.totalBytes} bytes total, showing the last ${Math.min(range.length, report.totalBytes)}]\n${report.output}`
    }
    const result = await machine.exec(
      jobOutputRangeScript(machine.dialect, job.id, range.offset, range.length),
      { timeoutMs: 60_000 }
    )
    return result.stdout
  }

  async kill(jobId: string): Promise<HomeChatJob> {
    const job = this.get(jobId)
    const machine = await this.deps.machines.open(job.machine)
    await machine.exec(jobKillScript(machine.dialect, job.id), { timeoutMs: 30_000 })
    this.watchers.get(job.id)?.abort()
    this.watchers.delete(job.id)
    Object.assign(job, { state: 'killed', exitCode: 143, endedAt: Date.now() })
    this.save()
    return job
  }

  /** Delete a finished job's folder on its machine. */
  async remove(jobId: string): Promise<void> {
    const job = this.get(jobId)
    if (job.state === 'running') {
      throw new Error(`Job ${job.id} is still running; kill it first.`)
    }
    const machine = await this.deps.machines.open(job.machine)
    await machine.exec(jobRemoveScript(machine.dialect, job.id), { timeoutMs: 30_000 })
    this.jobs.delete(job.id)
    this.save()
  }

  dispose(): void {
    this.disposed = true
    for (const controller of this.watchers.values()) {
      controller.abort()
    }
    this.watchers.clear()
  }

  private settle(job: HomeChatJob, report: JobReport): boolean {
    if (job.state !== 'running' || report.state === 'running') {
      return false
    }
    Object.assign(job, {
      state: report.state === 'exited' ? 'exited' : 'lost',
      exitCode: report.state === 'exited' ? report.exitCode : null,
      endedAt: Date.now()
    })
    this.save()
    return true
  }

  /** One blocking exec per running job: it returns when the job ends, so nothing polls the model. */
  private watch(job: HomeChatJob): void {
    if (this.watchers.has(job.id) || this.disposed) {
      return
    }
    const controller = new AbortController()
    this.watchers.set(job.id, controller)
    void (async () => {
      while (!controller.signal.aborted && job.state === 'running') {
        try {
          const machine = await this.deps.machines.open(job.machine)
          const result = await machine.exec(
            jobWatchScript(machine.dialect, job.id, NOTICE_TAIL_BYTES),
            {
              timeoutMs: WATCH_TIMEOUT_MS,
              signal: controller.signal
            }
          )
          if (result.timedOut) {
            continue
          }
          const report = parseJobReport(result.stdout)
          if (this.settle(job, report)) {
            this.deps.onJobEnded(job, 'output' in report ? report.output : '')
          } else if (report.state === 'running') {
            await sleep(5_000, controller.signal)
          }
        } catch {
          // Unreachable machine or dropped connection: try again later.
          await sleep(WATCH_RETRY_MS, controller.signal)
        }
      }
      this.watchers.delete(job.id)
    })()
  }

  private save(): void {
    const kept = [...this.jobs.values()]
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(-MAX_KEPT_JOBS)
    writeFileAtomically(this.path, JSON.stringify(kept, null, 2))
  }
}

function parseLaunchResult(result: {
  exitCode: number | null
  stdout: string
  stderr: string
}): JobReport {
  try {
    return parseJobReport(result.stdout)
  } catch (error) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(
      detail ? `Could not start the command: ${detail.slice(0, 2_000)}` : String(error),
      {
        cause: error
      }
    )
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}
