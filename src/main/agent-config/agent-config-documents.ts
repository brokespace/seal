import type { AgentConfigCollection } from '../../shared/agent-config/agent-config-catalog'
import { agentConfigDocNameProblem } from '../../shared/agent-config/agent-config-doc-names'
import {
  newDocumentContent,
  readFrontmatter,
  setFrontmatterFields
} from '../../shared/agent-config/agent-config-frontmatter'
import type {
  AgentConfigCopyResult,
  AgentConfigDocKind,
  AgentConfigScope,
  AgentConfigTarget,
  AgentConfigWriteResult
} from '../../shared/agent-config/agent-config-types'
import {
  joinMachinePath,
  machinePathBasename,
  machinePathDirname
} from '../../shared/machines/machine-paths'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { backupStamp, moveToBackups } from './agent-config-backups'
import { collectionEntryName } from './agent-config-doc-refs'
import { pathStates, readConfigFile, writeConfigFile } from './agent-config-file-io'
import {
  assertManagedPath,
  joinRelative,
  resolveTarget,
  scopeLayout,
  scopeRoot,
  type ResolvedTarget
} from './agent-config-locations'
import { copyMachineTree } from './agent-config-tree-copy'

/** How the page names a document it wants changed. */
export type DocumentRef = { kind: AgentConfigDocKind; scope: AgentConfigScope; path: string }

function requireName(kind: AgentConfigDocKind, name: string): string {
  const problem = agentConfigDocNameProblem(kind, name)
  if (problem) {
    throw new Error(problem)
  }
  return name.trim()
}

async function resolve(
  connection: MachineConnection,
  target: AgentConfigTarget
): Promise<ResolvedTarget> {
  return resolveTarget(target, await connection.files.homeDir())
}

type Placed = { collection: AgentConfigCollection; dir: string }

function collections(
  resolved: ResolvedTarget,
  scope: AgentConfigScope,
  kind: AgentConfigDocKind
): Placed[] {
  const layoutScope = scope === 'local' ? 'project' : scope
  return scopeLayout(resolved, layoutScope)
    .collections.filter((collection) => collection.kind === kind)
    .map((collection) => ({
      collection,
      dir: joinRelative(scopeRoot(resolved, layoutScope), collection.dir)
    }))
}

function collectionOf(resolved: ResolvedTarget, ref: DocumentRef): Placed {
  const normalized = ref.path.replaceAll('\\', '/')
  const found = collections(resolved, ref.scope, ref.kind).find((placed) =>
    normalized.startsWith(`${placed.dir.replaceAll('\\', '/')}/`)
  )
  if (!found) {
    throw new Error(`${ref.path} is not one of ${resolved.layout.label}'s ${ref.kind}s`)
  }
  return found
}

function documentPath(placed: Placed, name: string): { path: string; directory: string | null } {
  if (placed.collection.shape === 'skill-folders') {
    const directory = joinMachinePath(placed.dir, name)
    return { path: joinMachinePath(directory, 'SKILL.md'), directory }
  }
  return {
    path: joinRelative(placed.dir, `${name}${placed.collection.extension}`),
    directory: null
  }
}

async function requireMissing(
  connection: MachineConnection,
  path: string,
  what: string
): Promise<void> {
  const { states } = await pathStates(connection, [path])
  if (states.get(path) !== 'missing') {
    throw new Error(`There is already ${what} at ${path}`)
  }
}

function instructionsPath(
  resolved: ResolvedTarget,
  scope: AgentConfigScope,
  relative: string
): string {
  const { layout } = resolved
  const allowed =
    scope === 'user'
      ? layout.user.instructions
      : scope === 'local'
        ? layout.project.localInstructions
        : layout.project.instructions
  const nested =
    scope === 'project' &&
    layout.project.nestedInstructions.includes(relative.split('/').at(-1) ?? '') &&
    !relative.split('/').includes('..')
  if (!allowed.includes(relative) && !nested) {
    throw new Error(`${layout.label} does not read instructions from ${relative}`)
  }
  return joinRelative(scopeRoot(resolved, scope), relative)
}

export async function createDocument(
  connection: MachineConnection,
  args: {
    target: AgentConfigTarget
    kind: AgentConfigDocKind
    scope: AgentConfigScope
    /** A skill, subagent, command, prompt or rule name; for instructions, the file under the scope root. */
    name: string
    /** Which folder, for agents that read a kind from more than one. */
    collectionDir?: string
  }
): Promise<AgentConfigWriteResult> {
  const resolved = await resolve(connection, args.target)
  if (args.kind === 'instructions') {
    const path = instructionsPath(resolved, args.scope, args.name.trim())
    return writeConfigFile(connection, path, newDocumentContent('instructions', '', '.md'), {
      mustBeNew: true,
      validation: 'text'
    })
  }
  const name = requireName(args.kind, args.name)
  const placed =
    collections(resolved, args.scope, args.kind).find(
      (candidate) => !args.collectionDir || candidate.collection.dir === args.collectionDir
    ) ?? null
  if (!placed) {
    throw new Error(`${resolved.layout.label} has no ${args.kind}s here`)
  }
  const { path, directory } = documentPath(placed, name)
  await requireMissing(connection, directory ?? path, `a ${args.kind}`)
  return writeConfigFile(
    connection,
    path,
    newDocumentContent(args.kind, machinePathBasename(name), placed.collection.extension),
    { mustBeNew: true, validation: placed.collection.extension === '.toml' ? 'toml' : args.kind }
  )
}

/** Keeps a declared name in step with the folder or file after a copy or rename. */
async function declareName(
  connection: MachineConnection,
  path: string,
  kind: AgentConfigDocKind,
  name: string
): Promise<AgentConfigWriteResult | null> {
  if (kind !== 'skill' && kind !== 'subagent') {
    return null
  }
  const file = await readConfigFile(connection, path)
  const frontmatter = readFrontmatter(file.content)
  if (!file.exists || frontmatter.error || typeof frontmatter.data.name !== 'string') {
    return null
  }
  return writeConfigFile(connection, path, setFrontmatterFields(file.content, { name }), {
    validation: 'text'
  })
}

export async function duplicateDocument(
  connection: MachineConnection,
  args: { target: AgentConfigTarget; ref: DocumentRef; newName: string }
): Promise<AgentConfigWriteResult> {
  const resolved = await resolve(connection, args.target)
  const placed = collectionOf(resolved, args.ref)
  const name = requireName(args.ref.kind, args.newName)
  const { path, directory } = documentPath(placed, name)
  await requireMissing(connection, directory ?? path, `a ${args.ref.kind}`)
  if (directory) {
    await copyMachineTree(
      connection,
      machinePathDirname(args.ref.path) ?? args.ref.path,
      connection,
      directory
    )
  } else {
    const source = await readConfigFile(connection, args.ref.path)
    await writeConfigFile(connection, path, source.content, { mustBeNew: true, validation: 'text' })
  }
  const declared = await declareName(connection, path, args.ref.kind, machinePathBasename(name))
  return declared ?? { path, hash: (await readConfigFile(connection, path)).hash, backupPath: null }
}

export async function renameDocument(
  connection: MachineConnection,
  args: { target: AgentConfigTarget; ref: DocumentRef; newName: string }
): Promise<AgentConfigWriteResult> {
  if (args.ref.kind === 'instructions') {
    throw new Error('Agents look for instructions under a fixed name')
  }
  const resolved = await resolve(connection, args.target)
  const placed = collectionOf(resolved, args.ref)
  const name = requireName(args.ref.kind, args.newName)
  const { path, directory } = documentPath(placed, name)
  await requireMissing(connection, directory ?? path, `a ${args.ref.kind}`)
  const from = directory ? (machinePathDirname(args.ref.path) ?? args.ref.path) : args.ref.path
  const to = directory ?? path
  const parent = machinePathDirname(to)
  if (parent) {
    await connection.files.createDir(parent)
  }
  await connection.files.rename(from, to)
  const declared = await declareName(connection, path, args.ref.kind, machinePathBasename(name))
  return declared ?? { path, hash: (await readConfigFile(connection, path)).hash, backupPath: null }
}

/** Deleting moves the document (a skill's whole folder) into the backups folder. */
export async function deleteDocument(
  connection: MachineConnection,
  args: { target: AgentConfigTarget; ref: DocumentRef }
): Promise<{ backupPath: string }> {
  const resolved = await resolve(connection, args.target)
  const victim =
    args.ref.kind === 'instructions'
      ? args.ref.path
      : collectionOf(resolved, args.ref).collection.shape === 'skill-folders'
        ? (machinePathDirname(args.ref.path) ?? args.ref.path)
        : args.ref.path
  assertManagedPath(resolved, victim)
  return { backupPath: await moveToBackups(connection, resolved.home, victim, backupStamp()) }
}

export async function copyDocument(
  source: MachineConnection,
  destination: MachineConnection,
  args: {
    target: AgentConfigTarget
    ref: DocumentRef
    to: AgentConfigTarget
    toScope: AgentConfigScope
    /** Replace what is there; the replaced copy goes to the backups folder. */
    overwrite?: boolean
  }
): Promise<AgentConfigCopyResult> {
  const from = await resolve(source, args.target)
  const to = await resolve(destination, args.to)
  if (args.ref.kind === 'instructions') {
    assertManagedPath(from, args.ref.path)
    const scopeFiles = scopeLayout(to, args.toScope === 'local' ? 'project' : args.toScope)
    const relative =
      args.toScope === 'local' ? to.layout.project.localInstructions[0] : scopeFiles.instructions[0]
    if (!relative) {
      throw new Error(`${to.layout.label} reads no instructions file there`)
    }
    const path = joinRelative(scopeRoot(to, args.toScope), relative)
    const content = (await readConfigFile(source, args.ref.path)).content
    const written = await writeConfigFile(destination, path, content, {
      mustBeNew: !args.overwrite,
      validation: 'text'
    })
    return { path, backupPath: written.backupPath }
  }
  const placed = collectionOf(from, args.ref)
  const target = collections(to, args.toScope, args.ref.kind).find(
    (candidate) => candidate.collection.extension === placed.collection.extension
  )
  if (!target) {
    throw new Error(`${to.layout.label} has no ${args.ref.kind}s there in this format`)
  }
  const name =
    placed.collection.shape === 'skill-folders'
      ? machinePathBasename(machinePathDirname(args.ref.path) ?? args.ref.path)
      : collectionEntryName(args.ref.path, placed.collection)
  const { path, directory } = documentPath(target, name)
  if (!directory) {
    const content = (await readConfigFile(source, args.ref.path)).content
    const written = await writeConfigFile(destination, path, content, {
      mustBeNew: !args.overwrite,
      validation: 'text'
    })
    return { path, backupPath: written.backupPath }
  }
  const { states } = await pathStates(destination, [directory])
  let backupPath: string | null = null
  if (states.get(directory) !== 'missing') {
    if (!args.overwrite) {
      throw new Error(`${machinePathBasename(directory)} already exists`)
    }
    backupPath = await moveToBackups(destination, to.home, directory, backupStamp())
  }
  await copyMachineTree(
    source,
    machinePathDirname(args.ref.path) ?? args.ref.path,
    destination,
    directory
  )
  return { path, backupPath }
}
