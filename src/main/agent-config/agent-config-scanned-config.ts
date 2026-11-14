import { parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import { parseTomlObject } from '../../shared/agent-config/agent-config-toml-edit'
import type { MachineConnection } from '../machines/connection/machine-connection'
import type { MachineFileScanRecord } from '../machines/scan/machine-file-scan'
import { SCAN_HEAD_BYTES } from './agent-config-scan-plan'

const MAX_CONFIG_BYTES = 48 * 1024 * 1024

export type ParsedConfig = {
  value: Record<string, unknown> | null
  error?: string
  exists: boolean
}

export function parseConfig(path: string, text: string | null): ParsedConfig {
  if (text === null) {
    return { value: null, exists: false }
  }
  const parsed = path.endsWith('.toml') ? parseTomlObject(text) : parseJsonObject(text)
  return parsed.ok
    ? { value: parsed.value, exists: true }
    : { value: null, error: parsed.error, exists: true }
}

/** Reads whole files in as few round trips as possible: small ones already came with the scan. */
export class ConfigTexts {
  private readonly cache = new Map<string, Promise<string | null>>()

  constructor(
    private readonly connection: MachineConnection,
    private readonly records: readonly MachineFileScanRecord[]
  ) {}

  read(path: string): Promise<string | null> {
    let pending = this.cache.get(path)
    if (!pending) {
      const record = this.records.find((item) => item.path === path)
      pending = !record
        ? Promise.resolve(null)
        : record.bytes <= SCAN_HEAD_BYTES && Buffer.byteLength(record.head) === record.bytes
          ? Promise.resolve(record.head)
          : this.connection.files
              .readFile(path, MAX_CONFIG_BYTES)
              .then((read) => read.data.toString('utf8'))
      this.cache.set(path, pending)
    }
    return pending
  }
}
