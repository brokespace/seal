import type { DiskIndexLargestFile } from './disk-index-layout'

/** Slots of the Int32Array every walker shares with the coordinator. */
export const COUNTER_NEXT_ID = 0
export const COUNTER_IDLE_WALKERS = 1
export const COUNTER_SLOTS = 2

/** Numbers per folder record: id, parent, mtimeMs, ino, ownBytes, ownFiles, flags, reusedFrom, nameOffset, nameLength. */
export const RECORD_FIELDS = 10
export const LARGEST_FILES_KEPT = 1000

export type WalkStat = {
  dev: number
  ino: number
  nlink: number
  blocks: number
  mtimeMs: number
  isDirectory(): boolean
}

/** The only filesystem access a walker needs; injected so the blocking calls live in the entry file. */
export type WalkFs = {
  readdir(path: string): string[]
  /** Undefined when the path is gone. */
  lstat(path: string): WalkStat | undefined
}

export type WalkTask = {
  id: number
  parent: number
  name: string
  path: string
  /** This folder's node in the previous index, or -1. */
  prev: number
  mtimeMs: number
  ino: number
  selfBytes: number
}

export type WalkerInit = {
  rootDev: number
  /** Other devices that count as the same disk (macOS splits one disk into system and data volumes). */
  allowedDevs: number[]
  /** btrfs gives every subvolume its own device number; only the mount table says where to stop. */
  anyDev: boolean
  /** Folders never entered: other mount points and paths left out of the index. */
  stops: string[]
  /** Files modified after this make their folder re-read on the next scan. */
  hotAfterMs: number
  /** Folders modified after this may still change without a new timestamp. */
  racyAfterMs: number
  previous: SharedArrayBuffer | null
  counters: SharedArrayBuffer
}

export type WalkerMessage =
  | {
      type: 'batch'
      folders: number
      records: Float64Array<ArrayBuffer>
      names: Uint8Array<ArrayBuffer>
      files: number
      bytes: number
      reused: number
    }
  | { type: 'donate'; tasks: WalkTask[] }
  | { type: 'idle' }
  | { type: 'largest'; files: DiskIndexLargestFile[] }

export type WalkerCommand = { type: 'tasks'; tasks: WalkTask[] } | { type: 'finish' }
