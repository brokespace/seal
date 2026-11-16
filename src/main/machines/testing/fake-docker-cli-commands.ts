/** Second half of the fake `docker` CLI: the commands, and what each changes in the state. */
export const FAKE_DOCKER_CLI_COMMANDS = String.raw`const parse = (args, valued) => {
  const flags = {}
  const rest = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg.startsWith('-') || arg === '-') {
      rest.push(arg)
      continue
    }
    const equals = arg.startsWith('--') ? arg.indexOf('=') : -1
    const name = equals > 0 ? arg.slice(0, equals) : arg
    if (!valued.includes(name)) flags[name] = true
    else flags[name] = equals > 0 ? arg.slice(equals + 1) : args[++index]
  }
  return { flags, rest }
}
const has = (flags, long, letter) =>
  Boolean(flags[long]) || Object.keys(flags).some((flag) => /^-[A-Za-z]+$/.test(flag) && flag.includes(letter))

const inspect = (args, find, document, missing) => {
  const { flags, rest } = parse(args, ['--format', '-f'])
  flags['--format'] = flags['--format'] || flags['-f']
  for (const ref of rest) {
    const found = find(ref)
    if (found) out(render(formatOf(flags), document(found)))
    else {
      out('')
      complain(daemon(missing(ref)))
    }
  }
}

const removeImage = (ref, force) => {
  const image = findImage(ref)
  if (!image) return complain(daemon('No such image: ' + ref))
  const users = usersOfImage(image)
  const user = users.find(isRunning) || users[0]
  const byTag = image.tags.includes(ref)
  const conflict = (how, why) =>
    complain(daemon('conflict: unable to delete ' + (byTag ? ref : short(image.id)) + ' (' + how + ') - ' + why))
  if (byTag && image.tags.length > 1) {
    image.tags = image.tags.filter((tag) => tag !== ref)
    return out('Untagged: ' + ref)
  }
  if (byTag && user && !force) {
    return conflict('must be forced', 'container ' + short(user.id) + ' is using its referenced image ' + short(image.id))
  }
  if (byTag && user) {
    // The containerd image store keeps a forced-away tag's image, untagged, for its containers.
    image.tags = []
    return out('Untagged: ' + ref)
  }
  if (!byTag && user && isRunning(user)) {
    return conflict('cannot be forced', 'image is being used by running container ' + short(user.id))
  }
  if (!byTag && user && !force) {
    return conflict('must be forced', 'image is being used by stopped container ' + short(user.id))
  }
  image.tags.forEach((tag) => out('Untagged: ' + tag))
  out('Deleted: ' + image.id)
  state.images = state.images.filter((other) => other !== image)
}

const reclaimed = (title, names, bytes) => {
  if (names.length > 0) out([title].concat(names, ['']).join('\n'))
  out('Total reclaimed space: ' + size(bytes))
}
const total = (items, bytes) => items.reduce((sum, item) => sum + bytes(item), 0)

const commands = {
  'system df': (args) => {
    const { flags } = parse(args, ['--format'])
    if (has(flags, '--verbose', 'v')) {
      return process.stdout.write(
        render(formatOf(flags), {
          Images: imageRows(true),
          Containers: state.containers.map((container) => containerRow(container, true)),
          Volumes: state.volumes.map((volume) => volumeRow(volume, true)),
          BuildCache: state.buildCache.map(cacheRow)
        }) + '\n'
      )
    }
    const row = (type, items, active, bytes, percent) => {
      const all = total(items, bytes)
      const free = total(items.filter((item) => !active(item)), bytes)
      return {
        Active: String(items.filter(active).length),
        Reclaimable: size(free) + (percent ? ' (' + (all ? Math.round((free / all) * 100) : 0) + '%)' : ''),
        Size: size(all),
        TotalCount: String(items.length),
        Type: type
      }
    }
    printRows(flags, [
      row('Images', state.images, (image) => usersOfImage(image).length > 0, (image) => image.uniqueBytes, true),
      row('Containers', state.containers, isRunning, (container) => container.sizeBytes, true),
      row('Local Volumes', state.volumes, (volume) => usersOfVolume(volume).length > 0, (volume) => volume.sizeBytes, true),
      row('Build Cache', state.buildCache, (record) => record.inUse || record.shared, (record) => record.sizeBytes, false)
    ])
  },
  'container ls': (args) => {
    const { flags } = parse(args, ['--format'])
    const listed = state.containers.filter((container) => has(flags, '--all', 'a') || isRunning(container))
    if (has(flags, '--quiet', 'q')) {
      return listed.forEach((container) => out(flags['--no-trunc'] ? container.id : short(container.id)))
    }
    if (!flags['--format']) die('fake docker: ps needs --format or --quiet')
    printRows(flags, listed.map((container) => containerRow(container, Boolean(flags['--no-trunc']))))
  },
  'container stats': (args) => {
    const { flags } = parse(args, ['--format'])
    if (!flags['--no-stream']) die('fake docker: stats needs --no-stream')
    printRows(flags, state.containers.filter(isRunning).map((container) => statsRow(container, Boolean(flags['--no-trunc']))))
  },
  'container inspect': (args) => inspect(args, findContainer, containerDocument, (ref) => 'No such container: ' + ref),
  'image inspect': (args) => inspect(args, findImage, imageDocument, (ref) => 'No such image: ' + ref),
  'volume inspect': (args) => inspect(args, findVolume, volumeDocument, (ref) => 'get ' + ref + ': no such volume'),
  'image ls': (args) => printRows(parse(args, ['--format']).flags, imageRows(false)),
  'volume ls': (args) => printRows(parse(args, ['--format']).flags, state.volumes.map((volume) => volumeRow(volume, false))),
  'image history': (args) => {
    const { flags, rest } = parse(args, ['--format'])
    const image = findImage(rest[0])
    if (!image) die(daemon('No such image: ' + rest[0]))
    printRows(
      flags,
      image.layers.map((layer, index) => ({
        Comment: '',
        CreatedAt: layer.createdAt.replace(/\.\d+Z$/, 'Z'),
        CreatedBy: layer.createdBy,
        CreatedSince: since(layer.createdAt) + ' ago',
        ID: index === 0 ? image.id : '<missing>',
        Size: size(layer.sizeBytes)
      }))
    )
  },
  'container logs': (args) => {
    const { flags, rest } = parse(args, ['--tail', '-n'])
    const container = findContainer(rest[0])
    if (!container) die(daemon('No such container: ' + rest[0]))
    const tail = Number(flags['--tail'] || flags['-n'])
    const lines = Number.isFinite(tail) && tail >= 0 ? container.logs.slice(-tail || container.logs.length) : container.logs
    lines.forEach((line) => out(has(flags, '--timestamps', 't') ? line : line.slice(line.indexOf(' ') + 1)))
  },
  'container rm': (args) => {
    const { flags, rest } = parse(args, [])
    for (const ref of rest) {
      const container = findContainer(ref)
      if (!container) complain(daemon('No such container: ' + ref))
      else if (isRunning(container) && !has(flags, '--force', 'f')) {
        complain(daemon('cannot remove container "' + container.name + '": container is running: stop the container before removing or force remove'))
      } else {
        state.containers = state.containers.filter((other) => other !== container)
        out(ref)
      }
    }
  },
  'image rm': (args) => {
    const { flags, rest } = parse(args, [])
    rest.forEach((ref) => removeImage(ref, has(flags, '--force', 'f')))
  },
  'volume rm': (args) => {
    for (const name of parse(args, []).rest) {
      const volume = findVolume(name)
      const users = volume ? usersOfVolume(volume) : []
      if (!volume) complain(daemon('get ' + name + ': no such volume'))
      else if (users.length > 0) {
        complain(daemon('remove ' + name + ': volume is in use - [' + users.map((user) => user.id).join(', ') + ']'))
      } else {
        state.volumes = state.volumes.filter((other) => other !== volume)
        out(name)
      }
    }
  },
  'builder prune': (args) => {
    const { flags } = parse(args, ['--filter'])
    const filter = /^id=(.*)$/.exec(flags['--filter'] || '')
    if (flags['--filter'] && !filter) die('fake docker: builder prune filters only by id')
    const pruned = state.buildCache.filter(
      (record) =>
        !record.inUse &&
        (has(flags, '--all', 'a') || !record.shared) &&
        (!filter || (record.id === filter[1] && !state.buildCache.some((other) => other.parent === record.id)))
    )
    if (pruned.length > 0) out('ID\t\t\t\t\t\tRECLAIMABLE\tSIZE\t\tLAST ACCESSED')
    for (const record of pruned) {
      out((record.id + (record.shared ? '' : '*')).padEnd(40) + '\ttrue \t\t' + size(record.sizeBytes).padEnd(10) + '\t' + since(record.lastUsedAt) + ' ago')
    }
    state.buildCache = state.buildCache.filter((record) => !pruned.includes(record))
    out('Total:\t' + size(total(pruned, (record) => record.sizeBytes)))
  },
  'container prune': () => {
    const stopped = state.containers.filter((container) => !isRunning(container))
    state.containers = state.containers.filter(isRunning)
    reclaimed('Deleted Containers:', stopped.map((container) => container.id), total(stopped, (container) => container.sizeBytes))
  },
  'image prune': (args) => {
    const all = has(parse(args, ['--filter']).flags, '--all', 'a')
    const unused = state.images.filter((image) => usersOfImage(image).length === 0 && (all || image.tags.length === 0))
    state.images = state.images.filter((image) => !unused.includes(image))
    reclaimed(
      'Deleted Images:',
      unused.flatMap((image) => image.tags.map((tag) => 'untagged: ' + tag).concat('deleted: ' + image.id)),
      total(unused, (image) => image.uniqueBytes)
    )
  },
  'volume prune': (args) => {
    // Since Docker 23 only anonymous volumes go without --all, and every volume here is named.
    const all = has(parse(args, ['--filter']).flags, '--all', 'a')
    const unused = state.volumes.filter((volume) => all && usersOfVolume(volume).length === 0)
    state.volumes = state.volumes.filter((volume) => !unused.includes(volume))
    reclaimed('Deleted Volumes:', unused.map((volume) => volume.name), total(unused, (volume) => volume.sizeBytes))
  },
  'container run': (args) => {
    const valued = ['--pull', '--network', '--user', '--security-opt', '--entrypoint', '-v', '--volume', '--name']
    let index = 0
    const flags = {}
    for (; index < args.length && args[index].startsWith('-'); index++) {
      if (valued.includes(args[index])) flags[args[index]] = args[++index]
      else flags[args[index]] = true
    }
    const [ref, option, script] = args.slice(index)
    const mount = /^([^:]+):\/seal-volume:ro$/.exec(flags['-v'] || flags['--volume'] || '')
    if (!flags['--rm'] || flags['--entrypoint'] !== 'sh' || option !== '-c' || !mount) {
      die('fake docker: run only starts the read-only volume helper', 125)
    }
    const image = findImage(ref)
    const volume = findVolume(mount[1])
    if (!image) die("docker: Error response from daemon: No such image: " + ref + "\n\nRun 'docker run --help' for more information", 125)
    if (!volume) die('fake docker: the real CLI would create volume ' + mount[1], 125)
    if (!image.shell) {
      die('docker: Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: exec: "sh": executable file not found in $PATH', 127)
    }
    const run = spawnSync('sh', ['-c', script.split("'/seal-volume").join("'" + volumeDir(volume))], { stdio: 'inherit' })
    process.exit(run.status === null ? 1 : run.status)
  }
}

const lifecycle = (action) => (args) => {
  for (const ref of parse(args, ['--time', '-t', '--signal']).rest) {
    const container = findContainer(ref)
    if (!container) {
      complain(daemon('No such container: ' + ref))
      continue
    }
    if (action !== 'start' && isRunning(container)) {
      Object.assign(container, { state: 'exited', exitCode: 137, finishedAt: now() })
    }
    if (action !== 'stop') {
      Object.assign(container, { state: 'running', exitCode: 0, startedAt: now(), finishedAt: null })
    }
    out(ref)
  }
}
for (const action of ['stop', 'start', 'restart']) commands['container ' + action] = lifecycle(action)

const SHORTHANDS = {
  ps: 'container ls',
  inspect: 'container inspect',
  stats: 'container stats',
  logs: 'container logs',
  rm: 'container rm',
  run: 'container run',
  stop: 'container stop',
  start: 'container start',
  restart: 'container restart',
  rmi: 'image rm',
  images: 'image ls',
  history: 'image history'
}

const argv = process.argv.slice(2)
const grouped = commands[argv[0] + ' ' + argv[1]]
const command = grouped || commands[SHORTHANDS[argv[0]]]
if (!command) die('docker: unknown command: docker ' + argv.join(' '))
command(argv.slice(grouped ? 2 : 1))
save()
process.exitCode = failed ? 1 : 0
`
