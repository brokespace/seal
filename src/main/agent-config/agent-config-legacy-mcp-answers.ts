import { editJsonText, parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import {
  isPlainObject,
  stringList,
  valueAtPath
} from '../../shared/agent-config/agent-config-values'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { readConfigFile, writeConfigFile } from './agent-config-file-io'
import { mcpFile, type ResolvedTarget } from './agent-config-locations'

const LEGACY_MCP_ANSWER_KEYS = ['enabledMcpjsonServers', 'disabledMcpjsonServers']

/**
 * Older Claude Code kept the answer in `~/.claude.json` under the project and still moves it into
 * the local settings at start, so an answer left there would undo the one chosen now.
 */
export async function forgetLegacyMcpAnswer(
  connection: MachineConnection,
  resolved: ResolvedTarget,
  name: string
): Promise<void> {
  const path = mcpFile(resolved, 'local')?.location.sourcePath
  const { projectRoot } = resolved
  if (!path || !projectRoot) {
    return
  }
  const file = await readConfigFile(connection, path)
  const parsed = parseJsonObject(file.content)
  const answers = parsed.ok ? valueAtPath(parsed.value, ['projects', projectRoot]) : null
  const edits = LEGACY_MCP_ANSWER_KEYS.flatMap((key) => {
    const names = isPlainObject(answers) ? stringList(answers[key]) : []
    return names.includes(name)
      ? [{ path: ['projects', projectRoot, key], value: names.filter((other) => other !== name) }]
      : []
  })
  if (edits.length > 0) {
    await writeConfigFile(connection, path, editJsonText(file.content, edits), {
      expectedHash: file.hash,
      private: true
    })
  }
}
