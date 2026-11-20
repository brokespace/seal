import { stringify } from 'smol-toml'
import type { AgentConfigSkillSources } from './agent-config-layout-types'
import { parseTomlObject, removeTomlLines } from './agent-config-toml-edit'
import { scanToml } from './agent-config-toml-scan'
import type { AgentConfigSettingsEdit } from './agent-config-types'
import { cloneValue, deepEqual, isPlainObject } from './agent-config-values'

type SettingsLayer = Record<string, unknown> | null
type SkillFile = { path: string; directory: string | null }

const CLAUDE_OVERRIDES = 'skillOverrides'

function folderName(skill: SkillFile): string {
  return (skill.directory ?? skill.path).replaceAll('\\', '/').split('/').at(-1) ?? ''
}

function codexEntries(layer: SettingsLayer): Record<string, unknown>[] {
  const skills = layer?.skills
  const config = isPlainObject(skills) ? skills.config : undefined
  return Array.isArray(config) ? config.filter(isPlainObject) : []
}

/**
 * Whether the agent's settings switch a skill off. `layers` go from the weakest scope to the
 * strongest. Claude Code keys `skillOverrides` by the skill's folder name; Codex lists the
 * `SKILL.md` path in a `[[skills.config]]` table.
 */
export function isSkillSwitchedOff(
  kind: AgentConfigSkillSources['switch'],
  layers: readonly SettingsLayer[],
  skill: SkillFile
): boolean {
  if (kind === 'claude-overrides') {
    const name = folderName(skill)
    const said = layers
      .map((layer) => (isPlainObject(layer?.[CLAUDE_OVERRIDES]) ? layer[CLAUDE_OVERRIDES] : {}))
      .findLast((overrides) => Object.hasOwn(overrides, name))
    return said?.[name] === 'off'
  }
  if (kind === 'codex-config') {
    return layers.some((layer) =>
      codexEntries(layer).some((entry) => entry.path === skill.path && entry.enabled === false)
    )
  }
  return false
}

/** The settings edit that switches a Claude Code skill; `weaker` are the scopes below the edited one. */
export function claudeSkillSwitchEdit(
  skill: SkillFile,
  enabled: boolean,
  weaker: readonly SettingsLayer[]
): AgentConfigSettingsEdit {
  const path = [CLAUDE_OVERRIDES, folderName(skill)]
  if (!enabled) {
    return { path, value: 'off' }
  }
  // Removing this scope's entry is enough unless a weaker scope switches the skill off too.
  return isSkillSwitchedOff('claude-overrides', weaker, skill)
    ? { path, value: 'on' }
    : { path, remove: true }
}

function withoutEmptySkills(config: Record<string, unknown>): Record<string, unknown> {
  const skills = config.skills
  if (!isPlainObject(skills) || !Array.isArray(skills.config) || skills.config.length > 0) {
    return config
  }
  const { config: _config, ...otherSkills } = skills
  const { skills: _skills, ...others } = config
  return Object.keys(otherSkills).length > 0 ? { ...others, skills: otherSkills } : others
}

/**
 * Codex's config.toml with a skill switched on or off. Off is a `[[skills.config]]` table
 * naming the skill's file; on is the absence of one. Every other line stays as written.
 */
export function codexSkillSwitchText(text: string, skillPath: string, enabled: boolean): string {
  const parsed = parseTomlObject(text)
  if (!parsed.ok) {
    throw new Error(`The file is not valid TOML (${parsed.error}); fix it in the raw editor first`)
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const tables = scanToml(lines).filter((section) => {
    if (section.header < 0 || !lines[section.header]?.trim().startsWith('[[')) {
      return false
    }
    const table = parseTomlObject(lines.slice(section.header, section.end).join('\n'))
    return table.ok && codexEntries(table.value).some((entry) => entry.path === skillPath)
  })
  for (const table of tables.toReversed()) {
    removeTomlLines(lines, table.header, table.end)
  }
  if (!enabled) {
    while (lines.length > 0 && lines.at(-1)?.trim() === '') {
      lines.pop()
    }
    lines.push(
      ...(lines.length > 0 ? [''] : []),
      '[[skills.config]]',
      stringify({ path: skillPath }).trim(),
      'enabled = false',
      ''
    )
  }
  const next = lines.join(eol)

  const expected = cloneValue(parsed.value)
  const kept = codexEntries(expected).filter((entry) => entry.path !== skillPath)
  const entries = enabled ? kept : [...kept, { path: skillPath, enabled: false }]
  expected.skills = { ...(isPlainObject(expected.skills) ? expected.skills : {}), config: entries }
  const result = parseTomlObject(next)
  if (!result.ok || !deepEqual(withoutEmptySkills(result.value), withoutEmptySkills(expected))) {
    throw new Error('The edit would have changed other parts of the file, so nothing was written')
  }
  return next
}
