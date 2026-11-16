import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export function hashDockerFixtureDirectory(fixtureDir: string): string {
  const hash = createHash('sha256')
  const pending = [fixtureDir]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (!directory) {
      continue
    }
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(absolutePath)
        continue
      }
      const relativePath = path.relative(fixtureDir, absolutePath).split(path.sep).join('/')
      hash.update(relativePath)
      hash.update('\0')
      hash.update(readFileSync(absolutePath))
      hash.update('\0')
    }
  }
  return hash.digest('hex').slice(0, 16)
}

function fixtureDirectory(
  root: string,
  name: 'docker-ssh-host' | 'docker-ssh-host-systemd'
): string {
  return path.join(root, 'tests', 'e2e', 'fixtures', name)
}

function imageIsBuilt(image: string): boolean {
  return spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0
}

function buildImage(image: string, fixtureDir: string, buildArgs: string[] = []): void {
  execFileSync(
    'docker',
    [
      'build',
      '--tag',
      image,
      ...buildArgs.flatMap((buildArg) => ['--build-arg', buildArg]),
      '--file',
      path.join(fixtureDir, 'Dockerfile'),
      fixtureDir
    ],
    { stdio: 'inherit', timeout: 300_000 }
  )
}

export function getDockerSshHostImage(root = process.cwd()): string {
  return (
    process.env.ORCA_E2E_SSH_DOCKER_IMAGE ??
    `orca-e2e-ssh-host:${hashDockerFixtureDirectory(fixtureDirectory(root, 'docker-ssh-host'))}`
  )
}

export function prepareDockerSshHostImage(root: string): void {
  if (process.env.ORCA_E2E_SSH_DOCKER_IMAGE) {
    return
  }
  buildImage(getDockerSshHostImage(root), fixtureDirectory(root, 'docker-ssh-host'))
}

export function ensureDockerSshHostImage(root: string): void {
  if (process.env.ORCA_E2E_SSH_DOCKER_IMAGE || imageIsBuilt(getDockerSshHostImage(root))) {
    return
  }
  prepareDockerSshHostImage(root)
}

/** Builds the systemd host on the base SSH host image unless it is already built, and returns its tag. */
export function ensureDockerSystemdSshHostImage(
  root: string,
  /** polkit: false is the image whose host refuses `loginctl enable-linger` to its user. */
  options: { polkit?: boolean } = {}
): string {
  ensureDockerSshHostImage(root)
  const baseImage = getDockerSshHostImage(root)
  const fixtureDir = fixtureDirectory(root, 'docker-ssh-host-systemd')
  // The base tag carries the base fixture's hash, so a change to either directory gives a new tag.
  const digest = createHash('sha256')
    .update(`${baseImage}\0${hashDockerFixtureDirectory(fixtureDir)}`)
    .digest('hex')
    .slice(0, 16)
  const polkit = options.polkit ?? true
  const image = `seal-e2e-ssh-host-systemd:${digest}${polkit ? '' : '-nopolkit'}`
  if (!imageIsBuilt(image)) {
    buildImage(image, fixtureDir, [`BASE_IMAGE=${baseImage}`, ...(polkit ? [] : ['POLKIT='])])
  }
  return image
}
