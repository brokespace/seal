import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getSystemCodexHomePath } from '../codex/configuration/homes/codex-home-paths'
import { readMcpServerTomlOwnership } from '../codex/configuration/toml/config-toml-mcp-servers'

/** Server names the account's config.toml defines, which Codex would otherwise load. */
export async function codexConfigServerNames(
  codexHome: string | null | undefined
): Promise<string[]> {
  try {
    const config = await readFile(
      join(codexHome || getSystemCodexHomePath(), 'config.toml'),
      'utf8'
    )
    return [...readMcpServerTomlOwnership(config).names]
  } catch {
    return []
  }
}
