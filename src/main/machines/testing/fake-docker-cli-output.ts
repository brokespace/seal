/** First half of the fake `docker` CLI: its state, and the rows and documents Docker prints. */
export const FAKE_DOCKER_CLI_OUTPUT = String.raw`#!/usr/bin/env node
'use strict'
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const home = path.dirname(process.argv[1])
const stateFile = process.env.SEAL_FAKE_DOCKER_STATE || path.join(home, 'STATE_FILE_NAME')
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
const ZERO_TIME = '0001-01-01T00:00:00Z'
let failed = false

const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
const out = (text) => process.stdout.write(text + '\n')
const complain = (message) => {
  process.stderr.write(message + '\n')
  failed = true
}
const die = (message, code) => {
  process.stderr.write(message + '\n')
  process.exit(code || 1)
}
const daemon = (message) => 'Error response from daemon: ' + message

if (state.permissionDenied) {
  die('permission denied while trying to connect to the docker API at unix:///var/run/docker.sock')
}
if (state.daemonDown) {
  die(
    'failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory'
  )
}

const human = (bytes, units, base) => {
  let value = bytes
  let unit = 0
  while (value >= base && unit < units.length - 1) {
    value /= base
    unit++
  }
  return Number(value.toPrecision(4)) + units[unit]
}
const size = (bytes) => human(bytes, ['B', 'kB', 'MB', 'GB', 'TB'], 1000)
const binarySize = (bytes) => human(bytes, ['B', 'KiB', 'MiB', 'GiB', 'TiB'], 1024)
const epoch = (iso) => Date.parse(iso.replace(/\.\d+Z$/, 'Z'))
const listedTime = (iso) => iso.replace('T', ' ').replace(/Z$/, '') + ' +0000 UTC'
const since = (iso) => {
  const seconds = Math.max(0, Math.floor((Date.now() - epoch(iso)) / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (seconds < 1) return 'Less than a second'
  if (seconds < 60) return seconds === 1 ? '1 second' : seconds + ' seconds'
  if (minutes < 60) return minutes === 1 ? 'About a minute' : minutes + ' minutes'
  if (hours < 48) return hours === 1 ? 'About an hour' : hours + ' hours'
  if (hours < 24 * 7 * 2) return Math.floor(hours / 24) + ' days'
  if (hours < 24 * 30 * 2) return Math.floor(hours / 24 / 7) + ' weeks'
  if (hours < 24 * 365 * 2) return Math.floor(hours / 24 / 30) + ' months'
  return Math.floor(hours / 24 / 365) + ' years'
}
const now = () => new Date().toISOString()
const bare = (id) => id.replace(/^sha256:/, '')
const short = (id) => bare(id).slice(0, 12)

const isRunning = (container) => container.state === 'running' || container.state === 'paused'
const usersOfImage = (image) => state.containers.filter((container) => container.imageId === image.id)
const usersOfVolume = (volume) =>
  state.containers.filter((container) => container.mounts.some((mount) => mount.volume === volume.name))
const findContainer = (ref) =>
  state.containers.find((container) => container.name === ref) ||
  state.containers.find((container) => ref.length >= 4 && container.id.startsWith(ref))
const findImage = (ref) =>
  state.images.find((image) => image.tags.includes(ref) || image.tags.includes(ref + ':latest')) ||
  state.images.find((image) => bare(ref).length >= 4 && bare(image.id).startsWith(bare(ref)))
const findVolume = (name) => state.volumes.find((volume) => volume.name === name)

const volumeDir = (volume) => {
  const dir = volume.dir || path.join(home, 'docker-volumes', volume.name)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(volume.files || {})) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
      fs.writeFileSync(path.join(dir, name), content)
    }
  }
  return dir
}
const mountpoint = (volume) =>
  volume.readable ? volumeDir(volume) : '/var/lib/docker/volumes/' + volume.name + '/_data'

const status = (container) => {
  if (container.state === 'created') return 'Created'
  if (isRunning(container)) {
    return 'Up ' + since(container.startedAt) + (container.state === 'paused' ? ' (Paused)' : '')
  }
  return 'Exited (' + container.exitCode + ') ' + since(container.finishedAt) + ' ago'
}

const imageRows = (measured) =>
  state.images.flatMap((image) =>
    (image.tags.length > 0 ? image.tags : ['<none>:<none>']).map((tag) => ({
      Containers: String(usersOfImage(image).length),
      CreatedAt: listedTime(image.createdAt),
      CreatedSince: since(image.createdAt) + ' ago',
      Digest: measured ? '' : '<none>',
      ID: image.id,
      Repository: tag.slice(0, tag.lastIndexOf(':')),
      SharedSize: measured ? size(image.sizeBytes - image.uniqueBytes) : 'N/A',
      Size: size(image.sizeBytes),
      Tag: tag.slice(tag.lastIndexOf(':') + 1),
      UniqueSize: measured ? size(image.uniqueBytes) : 'N/A'
    }))
  )

const containerRow = (container, full) => ({
  Command: JSON.stringify(container.command.join(' ')),
  CreatedAt: listedTime(container.createdAt),
  ID: full ? container.id : short(container.id),
  Image: container.image,
  Labels: '',
  LocalVolumes: String(container.mounts.length),
  Mounts: container.mounts.map((mount) => mount.volume).join(','),
  Names: container.name,
  Networks: container.networks.join(','),
  Platform: null,
  Ports: '',
  RunningFor: since(container.createdAt) + ' ago',
  Size: size(container.sizeBytes),
  State: container.state,
  Status: status(container)
})

const volumeRow = (volume, measured) => ({
  Availability: 'N/A',
  Driver: volume.driver,
  Group: 'N/A',
  Labels: Object.entries(volume.labels || {})
    .map((label) => label.join('='))
    .join(','),
  Links: measured ? String(usersOfVolume(volume).length) : 'N/A',
  Mountpoint: mountpoint(volume),
  Name: volume.name,
  Scope: 'local',
  Size: measured ? size(volume.sizeBytes) : 'N/A',
  Status: 'N/A'
})

const cacheRow = (record) => ({
  CacheType: record.cacheType,
  CreatedAt: listedTime(record.createdAt),
  CreatedSince: since(record.createdAt) + ' ago',
  Description: record.description,
  ID: record.id,
  InUse: String(record.inUse),
  LastUsedAt: listedTime(record.lastUsedAt),
  LastUsedSince: since(record.lastUsedAt) + ' ago',
  Parent: record.parent,
  Shared: String(record.shared),
  Size: size(record.sizeBytes),
  UsageCount: String(record.usageCount)
})

const statsRow = (container, full) => {
  const stats = container.stats
  const id = full ? container.id : short(container.id)
  return {
    BlockIO: size(stats.blockReadBytes) + ' / ' + size(stats.blockWriteBytes),
    CPUPerc: stats.cpuPercent.toFixed(2) + '%',
    Container: id,
    ID: id,
    MemPerc: ((stats.memUsageBytes / stats.memLimitBytes) * 100).toFixed(2) + '%',
    MemUsage: binarySize(stats.memUsageBytes) + ' / ' + binarySize(stats.memLimitBytes),
    Name: container.name,
    NetIO: size(stats.netRxBytes) + ' / ' + size(stats.netTxBytes),
    PIDs: String(stats.pids)
  }
}

const containerDocument = (container) => ({
  Id: container.id,
  Created: container.createdAt,
  Path: container.command[0],
  Args: container.command.slice(1),
  State: Object.assign(
    {
      Status: container.state,
      Running: isRunning(container),
      Paused: container.state === 'paused',
      Restarting: false,
      OOMKilled: false,
      Dead: false,
      Pid: isRunning(container) ? 4242 : 0,
      ExitCode: container.exitCode,
      Error: '',
      StartedAt: container.startedAt || ZERO_TIME,
      FinishedAt: container.finishedAt || ZERO_TIME
    },
    container.health ? { Health: { Status: container.health, FailingStreak: 0, Log: [] } } : {}
  ),
  Image: container.imageId,
  Name: '/' + container.name,
  RestartCount: 0,
  Platform: 'linux',
  HostConfig: { RestartPolicy: { Name: container.restartPolicy, MaximumRetryCount: 0 } },
  Mounts: container.mounts.map((mount) => ({
    Type: 'volume',
    Name: mount.volume,
    Source: findVolume(mount.volume) ? mountpoint(findVolume(mount.volume)) : '',
    Destination: mount.destination,
    Driver: 'local',
    Mode: mount.readOnly ? 'ro' : 'z',
    RW: !mount.readOnly,
    Propagation: ''
  })),
  Config: { Cmd: container.command, Image: container.image, Labels: {} },
  NetworkSettings: {
    Ports: container.ports,
    Networks: Object.fromEntries(container.networks.map((network) => [network, { Aliases: null }]))
  }
})

const imageDocument = (image) => ({
  Id: image.id,
  RepoTags: image.tags,
  RepoDigests: [],
  Created: image.createdAt,
  Architecture: 'amd64',
  Os: 'linux',
  Size: image.sizeBytes,
  RootFS: { Type: 'layers', Layers: image.layers.map((_, index) => 'sha256:' + String(index).repeat(64)) }
})

const volumeDocument = (volume) => ({
  CreatedAt: volume.createdAt,
  Driver: volume.driver,
  Labels: Object.keys(volume.labels || {}).length > 0 ? volume.labels : null,
  Mountpoint: mountpoint(volume),
  Name: volume.name,
  Options: null,
  Scope: 'local'
})

// Go escapes these three characters in JSON it prints.
const goJson = (value) =>
  JSON.stringify(value).replace(/[<>&]/g, (character) => '\\u00' + character.charCodeAt(0).toString(16))

const lookup = (scope, field) => {
  if (field === '.') return scope
  return field
    .slice(1)
    .split('.')
    .reduce((value, key) => {
      if (value === null || typeof value !== 'object' || !(key in value)) {
        die("template: :1: executing \"\" at <" + field + ">: can't evaluate field " + key)
      }
      return value[key]
    }, scope)
}

// The Go template subset Seal uses: fields, json, and range over a list.
const render = (template, scope) => {
  let rest = template
  let text = ''
  for (;;) {
    const open = rest.indexOf('{{')
    if (open < 0) return text + rest
    const close = rest.indexOf('}}', open)
    const action = rest.slice(open + 2, close).trim()
    text += rest.slice(0, open)
    rest = rest.slice(close + 2)
    if (action.startsWith('range ')) {
      const end = rest.indexOf('{{end}}')
      const body = rest.slice(0, end)
      rest = rest.slice(end + '{{end}}'.length)
      for (const item of lookup(scope, action.slice('range '.length))) text += render(body, item)
    } else if (action.startsWith('json ')) {
      text += goJson(lookup(scope, action.slice('json '.length)))
    } else if (action.startsWith('.')) {
      text += String(lookup(scope, action))
    } else {
      die('template: :1: function "' + action.split(' ')[0] + '" not defined')
    }
  }
}
const formatOf = (flags) => (flags['--format'] || '{{json .}}').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
const printRows = (flags, rows) => rows.forEach((row) => out(render(formatOf(flags), row)))
`
