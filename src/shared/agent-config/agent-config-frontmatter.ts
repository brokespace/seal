import { isMap, parseDocument } from 'yaml'
import type { AgentConfigDocKind, AgentConfigIssue } from './agent-config-types'
import { isPlainObject } from './agent-config-values'

export type Frontmatter = {
  /** The document opens with a `---` block. */
  present: boolean
  /** That block is closed; false when the text was cut off inside it. */
  complete: boolean
  data: Record<string, unknown>
  body: string
  /** Why the block is not valid YAML. */
  error?: string
}

const BLOCK = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/

export function readFrontmatter(markdown: string): Frontmatter {
  const match = BLOCK.exec(markdown)
  if (!match) {
    const present = /^\uFEFF?---[ \t]*\r?\n/.test(markdown)
    return { present, complete: false, data: {}, body: present ? '' : markdown }
  }
  const body = markdown.slice(match[0].length)
  const document = parseDocument(match[2], { prettyErrors: true })
  if (document.errors.length > 0) {
    const message = document.errors[0]?.message.split('\n')[0] ?? 'invalid YAML'
    return { present: true, complete: true, data: {}, body, error: message }
  }
  const data: unknown = document.toJS()
  return { present: true, complete: true, data: isPlainObject(data) ? data : {}, body }
}

/**
 * Sets front matter fields without reprinting the rest: comments, key order and fields Seal does
 * not know stay as written. An undefined value removes the field.
 */
export function setFrontmatterFields(
  markdown: string,
  fields: Record<string, string | undefined>
): string {
  const match = BLOCK.exec(markdown)
  if (!match) {
    const lines = Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    return lines.length > 0 ? `---\n${lines.join('\n')}\n---\n\n${markdown}` : markdown
  }
  const document = parseDocument(match[2])
  if (document.errors.length > 0) {
    throw new Error('The front matter is not valid YAML; fix it in the editor first')
  }
  if (!isMap(document.contents)) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: an empty map node is valid contents; the library types contents by the parsed input.
    document.contents = document.createNode({}) as unknown as typeof document.contents
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      document.delete(key)
    } else {
      document.set(key, value)
    }
  }
  const yaml = document.toString({ lineWidth: 0 }).replace(/\r?\n$/, '')
  return `${match[1]}${yaml}${match[3]}${markdown.slice(match[0].length)}`
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_NAME = 64
const MAX_DESCRIPTION = 1024

function issue(
  severity: AgentConfigIssue['severity'],
  message: string,
  field?: string
): AgentConfigIssue {
  return field ? { severity, message, field } : { severity, message }
}

function checkName(
  data: Record<string, unknown>,
  expected: string | undefined,
  what: string,
  issues: AgentConfigIssue[]
): void {
  const name = data.name
  if (typeof name !== 'string' || name.trim() === '') {
    issues.push(issue('error', `The front matter needs a name for the ${what}`, 'name'))
    return
  }
  if (name.length > MAX_NAME || !SLUG.test(name)) {
    issues.push(
      issue('error', `Name: lowercase letters, digits and hyphens, ${MAX_NAME} at most`, 'name')
    )
  } else if (expected !== undefined && expected !== name) {
    issues.push(
      issue(
        'warning',
        `The name "${name}" differs from its ${what === 'skill' ? 'folder' : 'file'} "${expected}"`,
        'name'
      )
    )
  }
}

function checkDescription(
  data: Record<string, unknown>,
  required: boolean,
  issues: AgentConfigIssue[]
): void {
  const description = data.description
  if (description === undefined || description === null || description === '') {
    if (required) {
      issues.push(
        issue(
          'error',
          'Add a description: the agent reads it to decide when to use this',
          'description'
        )
      )
    }
  } else if (typeof description !== 'string') {
    issues.push(issue('error', 'The description must be text', 'description'))
  } else if (description.length > MAX_DESCRIPTION) {
    issues.push(
      issue(
        'error',
        `The description is ${description.length} characters; ${MAX_DESCRIPTION} at most`,
        'description'
      )
    )
  }
}

function checkToolList(
  data: Record<string, unknown>,
  key: string,
  issues: AgentConfigIssue[]
): void {
  const value = data[key]
  const ok =
    value === undefined ||
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  if (!ok) {
    issues.push(
      issue('error', `${key} must be a comma-separated line or a list of tool names`, key)
    )
  }
}

/**
 * What is wrong with a markdown document of this kind. `expectedName` is the folder (skill) or
 * file (subagent) name the declared name should match. Errors stop a save; warnings do not.
 */
export function validateMarkdownDocument(
  kind: AgentConfigDocKind,
  content: string,
  expectedName?: string
): AgentConfigIssue[] {
  if (kind === 'instructions') {
    return []
  }
  const issues: AgentConfigIssue[] = []
  const frontmatter = readFrontmatter(content)
  if (frontmatter.present && !frontmatter.complete) {
    return [issue('error', 'The front matter is not closed with a --- line')]
  }
  if (frontmatter.error) {
    return [issue('error', `The front matter is not valid YAML: ${frontmatter.error}`)]
  }
  const needsFrontmatter = kind === 'skill' || kind === 'subagent'
  if (!frontmatter.present) {
    return needsFrontmatter
      ? [issue('error', `Start the file with front matter: a --- block with name and description`)]
      : []
  }
  const { data } = frontmatter
  if (kind === 'skill' || kind === 'subagent') {
    checkName(data, expectedName, kind, issues)
  }
  checkDescription(data, needsFrontmatter, issues)
  checkToolList(data, kind === 'subagent' ? 'tools' : 'allowed-tools', issues)
  if (needsFrontmatter && frontmatter.body.trim() === '') {
    issues.push(issue('warning', 'There are no instructions under the front matter'))
  }
  return issues
}

function title(name: string): string {
  return name
    .split(/[-_/]/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ')
}

/** A valid starting document, so a new item saves without a round of validation errors. */
export function newDocumentContent(
  kind: AgentConfigDocKind,
  name: string,
  extension: string
): string {
  if (extension === '.toml') {
    return `description = "${title(name)}"\nprompt = """\nDescribe what the agent should do.\n"""\n`
  }
  switch (kind) {
    case 'skill':
      return `---\nname: ${name}\ndescription: What this skill does, and when the agent should use it.\n---\n\n# ${title(name)}\n\nSteps for the agent to follow.\n`
    case 'subagent':
      return `---\nname: ${name}\ndescription: When the main agent should hand work to this subagent.\n---\n\nYou are a specialist. Describe how to do the work.\n`
    case 'command':
    case 'prompt':
      return `---\ndescription: ${title(name)}\n---\n\nWhat the agent should do when this runs. $ARGUMENTS\n`
    case 'rule':
      return `---\ndescription: ${title(name)}\nalwaysApply: false\n---\n\nWhat the agent should keep in mind.\n`
    case 'instructions':
      return `# Instructions\n\nWhat every agent session here should know.\n`
  }
}
