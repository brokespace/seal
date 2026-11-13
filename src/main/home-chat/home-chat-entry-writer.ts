import { randomUUID } from 'node:crypto'
import type { HomeChatEntry } from '../../shared/home-chat/home-chat-types'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type HomeChatEntryFields = DistributiveOmit<HomeChatEntry, 'id' | 'rev' | 'at'>

export type HomeChatEntryHandle<E extends HomeChatEntry = HomeChatEntry> = {
  readonly id: string
  current: () => E
  update: (patch: Partial<DistributiveOmit<E, 'id' | 'rev' | 'at' | 'kind'>>) => void
}

/** Every change to an entry is a new revision, so viewers can apply copies in any order. */
export class HomeChatEntryWriter {
  constructor(private readonly emit: (entry: HomeChatEntry) => void) {}

  create<F extends HomeChatEntryFields>(
    fields: F
  ): HomeChatEntryHandle<Extract<HomeChatEntry, { kind: F['kind'] }>> {
    type E = Extract<HomeChatEntry, { kind: F['kind'] }>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: F is E without the writer-owned id/rev/at fields.
    let entry = { ...fields, id: randomUUID(), rev: 1, at: Date.now() } as unknown as E
    this.emit(entry)
    return {
      id: entry.id,
      current: () => entry,
      update: (patch) => {
        entry = { ...entry, ...patch, rev: entry.rev + 1 }
        this.emit(entry)
      }
    }
  }
}
