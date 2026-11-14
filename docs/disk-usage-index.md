# Disk usage index

The **Disk** detail on a machine's page (see [Machines](./machines.md#resource-details)) answers "what is taking the space on this machine". This document is the design of what sits behind it: a persistent index of folder sizes that each machine keeps for itself in the background.

## The problem

The first version measured on demand. Opening the panel ran `du -xk -d 1` over the folder on screen, and every drill-down ran it again one level deeper. On a small disk that takes a second. On `kessel-ml` (Linux, 24 cores, several large disks) the first `du` walked the whole filesystem at whatever priority the SSH session had, never finished before the 90 second limit, and started from nothing the next time the panel was opened.

What was wrong was the shape of it, not the tool:

- The cost was paid while someone was waiting, and paid again for every folder they opened.
- Nothing was kept. Two views of the same folder a minute apart cost two walks.
- A walk of a disk that had not changed cost the same as a walk of one that had.

## What it does now

- Every machine Seal is connected to runs a small **index daemon**. It walks each local disk in the background at the lowest CPU and disk priority the machine offers and stores one index file per disk.
- Opening the panel reads the stored index. Folder sizes appear at once, with the index's age, and a progress line while a scan is running.
- After the first scan, rescans are **incremental**: a folder whose modification time and inode have not changed is not read again.
- The same index serves the drill-down, the largest files and the largest folders, on the desktop and on the phone.
- A machine that cannot run the index (no Node 20 or newer, or the daemon would not start) falls back to the old on-demand `df` and `du` and says why.

## Pieces

| Piece                                                    | Where                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Index program: daemon, query client, one-off scan        | `src/main/machines/disk-index/disk-usage-index-entry.ts`                            |
| Coordinator for one scan                                 | `disk-index/disk-index-scan.ts`                                                     |
| Walker (runs on worker threads)                          | `disk-index/disk-index-walker.ts`                                                   |
| Turning walker records into the stored layout            | `disk-index/disk-index-assemble.ts`                                                 |
| File layout and reading it back                          | `disk-index/disk-index-layout.ts`, `disk-index-file.ts`                             |
| Which disks exist and where a walk must stop             | `disk-index/disk-index-mounts.ts`                                                   |
| Scheduling, configuration and answering requests         | `disk-index/disk-index-daemon.ts`, `disk-index-config.ts`                           |
| Listing a folder, largest files, largest folders         | `disk-index/disk-index-query.ts`                                                    |
| Unix socket between the query client and the daemon      | `disk-index/disk-index-socket.ts`                                                   |
| Starting the daemon and asking it one question, per host | `src/main/machines/resources/machine-disk-index.ts`, `machine-disk-index-script.ts` |
| Request and reply types shared with the renderer and app | `src/shared/machines/machine-disk-index-types.ts`                                   |
| Desktop views                                            | `src/renderer/src/components/machines/resources/MachineDisk*.tsx`                   |
| Phone screen                                             | `mobile/src/seal/machines/MachineDiskScreen.tsx`                                    |

```
 desktop renderer ── IPC ──┐                      ┌─ this computer ──────────────┐
                           ├─ queryMachineDiskIndex│  sh ─ node program query ──┐ │
 phone ── RPC sealMachines │   (main, or a Seal    │                  unix socket│ │
          .diskIndex ──────┘    server)            │  node program daemon ◄─────┘ │
                                  │                │   ├ scan thread ─ N walkers  │
                                  │ runMachineHostScript (local / SSH / Seal      │
                                  └──────────────► │   └ ~/.seal/disk-index/*.bin │
                                                   └─ or the SSH / server machine ┘
```

## The program

The whole index is **one JavaScript file with no dependencies beyond Node**, about 60 KB. It has to be copyable to another machine as a single file, so it is bundled on its own (`config/build-plugins/disk-usage-index-bundle.ts`) rather than as one more entry of the main build, where it would share chunks with the main process as soon as both imported the same module. The build fails if the bundle requires anything but Node's own modules. The file lands at `out/main/disk-usage-index-entry.js`, is listed in `asarUnpack`, and ships with the Seal server too. It has three modes:

- `daemon` keeps the indexes fresh and answers requests on a Unix socket.
- `query <request>` sends one request to the daemon and prints the JSON reply. Exit code 3 means no daemon answered.
- `scan <folder>` indexes one folder once and prints the timings. The benchmark uses it.

Nothing native is bundled, so there is no per-platform binary to package or sign. That was a deciding factor; see [Options considered](#options-considered).

## Where it runs, and how it gets there

The index always lives **on the machine whose disk it describes**, in `~/.seal/disk-index/`:

| File                          | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `disk-usage-index-<hash>.cjs` | The program. The name carries a hash of its bytes. |
| `daemon.sock`                 | The daemon's socket                                |
| `index-<hash of mount>.bin`   | One stored index per disk                          |
| `config.json`                 | Disks the person added or left out                 |
| `node-path`, `daemon.log`     | The Node that was found; the daemon's stderr       |

The folder is created `0700` and the files `0600`: folder names are private.

Every request goes through `queryMachineDiskIndex`, which builds one POSIX script and runs it with `runMachineHostScript`. That is the path every other machine feature uses, so this computer, an SSH machine and a Seal server machine behave the same and no new channel was added. The script:

1. Checks that this build's program file exists. If not it prints `@noprogram`; main copies the file over with the machine's ordinary file channel (`connection.files.writeFile`) and runs the script again.
2. Finds a Node 20 or newer: on this computer the runtime Seal itself runs on (`ELECTRON_RUN_AS_NODE`); elsewhere the remembered path, then `PATH`, nvm, the usual install folders and the Node that a Seal server ships. No Node prints `@nonode`.
3. Runs `query`. If the daemon answers, that is the reply.
4. Otherwise deletes older program files, starts the daemon, and asks again:

   ```sh
   nohup ionice -c 3 nice -n 19 node disk-usage-index-<hash>.cjs daemon … &   # Linux
   nohup taskpolicy -b            node disk-usage-index-<hash>.cjs daemon … &   # macOS
   ```

`ionice -c 3` is the idle I/O class and `nice -n 19` the lowest CPU priority; either is skipped when the machine does not have it. The daemon also lowers its own priority with `os.setPriority`, which its threads inherit.

The daemon is started as soon as Seal talks to a machine, not when the panel opens, so the first index is usually already there: `ensureMachineDiskIndex` runs for this computer 30 seconds after the app starts and for any machine whenever its vitals are read, from the desktop or the phone. Apps launched by agents and tests (`ORCA_BACKGROUND_LAUNCH=1`) leave this computer's disk alone.

**Lifetime.** One daemon per user per machine; the socket decides who owns it. A daemon started by this computer exits when Seal's process is gone. A remote daemon exits after 7 days without a request, and Seal asks every 6 hours while connected, so a machine Seal no longer uses stops indexing by itself. A daemon from an older build hands over to the new one, but not in the middle of a scan it would have to start again.

**Relation to the Seal server.** The daemon is a process of its own rather than a thread inside `orcad`. A machine connected over SSH has no resident Seal at all, and an index tied to the server's lifetime would stop being kept whenever the server restarts for an update. The Seal server ships the same program and starts it the same way, which is how the phone reaches the index of a server machine.

## The stored index

One file per disk, written to a temporary name and renamed into place so a reader never sees half of one:

```
magic "SDIX" | header length | JSON summary | typed arrays, each aligned to 8 bytes
```

- The **summary** holds the root, when the scan started and finished, its mode, totals, and the 1,000 largest files. `readDiskIndexSummary` reads only this, which is all the mounts card needs.
- The **arrays** hold one entry per **folder** in depth-first pre-order: modification time, inode, own bytes, total bytes, total files, parent, subtree end, own file count, name offset and flags. A folder's subtree is the contiguous range `[node, subtreeEnd[node])`, so children are found by skipping from one subtree end to the next and no pointers are stored.

Files are not stored one by one. That is the main reason the index is small: about 60 bytes per folder, 30 MB for 533,000 folders holding 5 million files. A database with a row per file would be twenty times that and would need a native module.

The daemon keeps only summaries in memory. The arrays of the disk someone is browsing are loaded on demand and dropped 90 seconds after the last request.

## Scanning

`runDiskScan` runs on its own thread so the daemon keeps answering while it works. It starts N **walkers**, each a worker thread, and hands the root to one of them.

- A walker keeps a stack of folders (depth-first, so memory stays proportional to depth rather than breadth). For each it calls `readdirSync` and `lstatSync` on every entry. Blocking calls on a dedicated thread are the fast way to do this in Node: there is no promise, callback or thread-pool hop per file.
- **Work stealing.** A shared counter says how many walkers are idle. A busy walker checks it every 64 folders and, when someone is idle, gives away the older half of its stack: the entries nearest the root, which are the largest subtrees.
- Folder ids come from a shared atomic counter, so walkers never wait for each other to name a folder.
- Results go back as batches of up to 2,048 folders in transferable typed arrays, 10 numbers per folder plus the names.
- The default is half the machine's cores, at most 8. More walkers than that stop helping (see the benchmark) and the point is to stay out of the way.
- Each thread's V8 code range is capped at 64 MB, as elsewhere in Seal, so a host with an address-space limit can start them.

When the walkers finish, `assembleDiskIndex` orders the folders depth-first, adds the totals up from the leaves, and writes the file.

### Incremental rescans

A later scan loads the previous index into shared memory that every walker reads without a copy. For each folder a walker compares the modification time and inode it sees with what the index stored:

- **Unchanged:** the folder is not read. Its own bytes and file count are carried over, and only its subfolders (known from the index) are looked at, with one `lstat` each.
- **Changed, new, or flagged:** it is read in full.

Adding, removing or renaming an entry changes the folder's modification time, so those are always caught. Three things are not, and each has its own rule:

| Case                                                    | Rule                                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A file grows in place (a log, a database, a download)   | A folder holding a file modified in the last 7 days is flagged and read again on every scan. |
| A folder modified within 3 seconds of the scan          | Flagged and read again next time; its timestamp may not move for a second change.            |
| A file that grows in place after being quiet for a week | Caught by the next full scan. Every disk is read in full once every 24 hours.                |

A change deep in a tree does not change the modification time of the folders above it, so an incremental scan cannot skip a whole subtree on the strength of its top folder. It still visits every folder; what it saves is reading the folder and stat-ing its files, which is nearly all of the work. In the benchmark that is 5 million `lstat` calls replaced by 533,000.

Folders that could not be read last time and mount points are always looked at again.

### Schedule

- A disk with no index is scanned as soon as the daemon starts.
- After that, an incremental pass every 30 minutes and a full pass every 24 hours.
- **Back-off:** the next pass is at least ten times as far away as the last one took. A disk that takes 20 minutes to scan is rescanned every 3 hours or so, so scanning never becomes most of what the machine does.
- Deleting something from the panel asks for an incremental pass at once (`rescan`), so the numbers catch up.
- One disk is scanned at a time.

## Special cases

| Case                        | Handling                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Other mounts                | Each real filesystem is its own root with its own index. A walk never leaves its root's device (`st_dev`), and every other mount point under the root is recorded as a stub and not entered. The panel shows a stub as "not indexed".                                                                                                                                                                                                   |
| Virtual filesystems         | `/proc/self/mountinfo` gives each mount's type. Only known on-disk types are indexed. `proc`, `sysfs`, `tmpfs`, `devtmpfs`, `cgroup` and the rest are never walked, and `/proc`, `/sys`, `/dev` and `/run` are stops even if the mount table cannot be read.                                                                                                                                                                            |
| Network and removable disks | NFS, SMB, sshfs and similar, and volumes under `/Volumes` on a Mac, are listed with their capacity but not walked. **Index this disk** in the panel adds one; the choice is kept in `config.json`.                                                                                                                                                                                                                                      |
| Per-mount totals            | Capacity, used and available come from `statfs` on each mount, with a 3 second limit so a dead network share cannot hang the daemon. They are always live, whatever the index's age.                                                                                                                                                                                                                                                    |
| Hard links                  | A file with `n` links contributes `allocated / n` at each link. A filesystem's total counts the data once, and each folder shows its share, without a table of every inode seen.                                                                                                                                                                                                                                                        |
| Sparse and compressed files | Sizes are allocated blocks (`st_blocks × 512`), what the file costs on disk, as `du` reports.                                                                                                                                                                                                                                                                                                                                           |
| Permission errors           | A folder that cannot be opened is recorded as unreadable with what is known. The listing marks it and every total above it is shown as a lower bound. The mounts card says how many there were.                                                                                                                                                                                                                                         |
| Things that vanish mid-scan | A missing entry is skipped; the scan continues.                                                                                                                                                                                                                                                                                                                                                                                         |
| Docker overlay storage      | Each running container's merged view (`/var/lib/docker/overlay2/<id>/merged`) is an `overlay` mount, so it is a stop and is never counted. The layers under `overlay2/<id>/diff` are ordinary folders on the host disk and are counted once. Inside a container, an `overlay` root is treated as the local disk. What Docker could free is a separate question, answered from `docker system df` in the RAM detail and in **Clean up**. |
| btrfs                       | Subvolumes of one disk each have their own device number, so the device check is replaced by the mount table for btrfs, and subvolumes mounted separately belong to the root shown for the disk.                                                                                                                                                                                                                                        |
| macOS volumes               | `/` spans the read-only system volume and the data volume, which is one disk to a person, so both devices count as the root's.                                                                                                                                                                                                                                                                                                          |
| macOS privacy prompts       | Desktop, Documents, Downloads, iCloud Drive and cloud storage raise a permission dialog when a background program reads them. They are stops until the person chooses **Include them** in the panel.                                                                                                                                                                                                                                    |
| Symlinks                    | Never followed (`lstat`).                                                                                                                                                                                                                                                                                                                                                                                                               |
| Windows machines            | Not indexed. The resource details are for Linux and macOS machines; a Windows machine shows their notice instead.                                                                                                                                                                                                                                                                                                                       |

## What the panel shows

`queryMachineDiskIndex` takes one of six requests: `status`, `list`, `largest`, `rescan`, `setMountIndexed` and `setProtectedFolders`.

- **Mounts card:** every disk with live `statfs` figures, when its index was finished, how many files it covers, and a progress line while a scan runs (folders and files read so far against the previous scan's count).
- **What's taking space:** folder sizes come from the index. The files directly in the folder on screen are sized as they are now, so nothing deleted since the scan is listed and nothing new is missing.
- **Largest files:** the 200 largest of the 1,000 kept by the scan.
- **Largest folders:** the 200 folders with the most bytes directly inside them, which is where the space actually is, rather than every ancestor of one big folder.
- **Clean up:** unchanged; see [Machines](./machines.md#resource-details).

The desktop asks for `status` every 2.5 seconds while a scan runs and every 10 seconds otherwise, and reloads the open folder when the index's generation changes. There is no refresh button.

The phone uses the same requests through the `sealMachines.diskIndex` RPC of the computer or Seal server it is paired with, which calls the same `queryMachineDiskIndex`. No index data is copied to or stored on the desktop or the phone: both read the machine's own index through the channel they already use for that machine.

## Options considered

### What walks the disk

| Option                                                           | For                                                                                                                                                                                                                                                                                                            | Against                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node worker threads with blocking `readdir`/`lstat`** (chosen) | Nothing to package: Node is already on this computer (Seal's own runtime) and on every Seal server. Full control over the output, which is what makes the incremental scan, hard-link shares, stubs and the compact layout possible. Faster than the fastest native tool warm and within about 10% of it cold. | Needs Node 20 on an SSH machine; without it the panel falls back to `du`.                                                                                                                                                                                                            |
| Bundle **gdu** (Go)                                              | Fastest of the native tools here.                                                                                                                                                                                                                                                                              | A binary per OS and CPU to build, sign, notarise and copy to each machine (Linux x64 and arm64, macOS arm64 and x64, musl). No incremental mode: every run is a full walk. Its JSON export lists every file, so 5 million files means parsing gigabytes to keep 60 bytes per folder. |
| Bundle **dua-cli**, **dust** or **pdu** (Rust)                   | Good interactive tools.                                                                                                                                                                                                                                                                                        | The same packaging cost and no incremental mode. On the benchmark machine all three were several times slower than gdu and than this walker.                                                                                                                                         |
| `du` from the shell (what PR #17 did)                            | On every machine.                                                                                                                                                                                                                                                                                              | Single-threaded, no incremental mode, and a text stream to parse. Still used as the fallback.                                                                                                                                                                                        |
| Node `fs.promises` on the main thread, or one thread             | Simplest.                                                                                                                                                                                                                                                                                                      | One thread took 12 s where eight took 1.9 s, and async calls add a promise and a thread-pool hop per file.                                                                                                                                                                           |
| A native addon (Rust or C++ with `getdents64`/`statx`)           | The lowest possible per-file cost.                                                                                                                                                                                                                                                                             | A prebuilt binary per platform again, for the part of the cost that the incremental scan already removes.                                                                                                                                                                            |

The numbers decided it. A full walk matters once per disk and once a day; the scan that runs every 30 minutes is the incremental one, and no bundled tool has one. Given a walker in Node that is as fast as the best native tool, a binary would have bought packaging work and nothing else.

### Where the index lives

| Option                                                                           | Why not                                                                                                                                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| In Electron main                                                                 | Only this computer would have one, and a scan would compete with the app.                                                                                                                              |
| Inside the Seal server (`orcad`)                                                 | An SSH machine has no server. The index would also stop being kept across server restarts and would need a second implementation for SSH.                                                              |
| **A daemon per machine, started through the machine's command channel** (chosen) | One implementation and one code path for local, SSH and Seal server.                                                                                                                                   |
| On the desktop, synced from each machine                                         | The index of a large machine is tens of megabytes; copying it over SSH on every scan to answer a question about one folder is the wrong way round. Queries are small, so the questions travel instead. |

### How it is stored

| Option                                      | Why not                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| SQLite                                      | A native module the single-file program cannot carry, and a row per file.                   |
| JSON                                        | A tree of 500,000 folders is slow to parse and several times larger in memory than on disk. |
| **Flat typed arrays in pre-order** (chosen) | Loads with one read, needs no parsing, and is shared with walker threads as is.             |

### How changes are detected

| Option                                                                                 | Why not                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| inotify / fanotify / FSEvents watching the whole disk                                  | inotify needs one watch per folder (the default limit is far below a large disk's folder count); fanotify needs root; all of them miss whatever happened while the daemon was not running, so a walk is needed anyway. |
| **Folder modification times, plus the hot-folder rule and a daily full scan** (chosen) | Works on every filesystem with no privileges and no state besides the index itself.                                                                                                                                    |

## Benchmark

`config/seal/disk-index-benchmark/disk-index-benchmark.mjs` generates a tree and times this walker against `du` and the tools above:

```bash
node config/seal/disk-index-benchmark/disk-index-benchmark.mjs generate /tmp/bench-tree --files 5000000
node config/seal/disk-index-benchmark/disk-index-benchmark.mjs run /tmp/bench-tree --tools /path/to/tools          # warm cache
node config/seal/disk-index-benchmark/disk-index-benchmark.mjs run /tmp/bench-tree --tools /path/to/tools --cold   # cache dropped before each run
```

**Tree:** 5,000,000 files in 533,353 folders, 9.66 GiB allocated, ten files to a folder, five levels deep. **Machine:** 8-vCPU Intel Xeon cloud VM, 47 GB RAM, ext4 on a virtual disk, Linux 6.12, Node 22.23. **Tools:** gdu 5.39.0, dua 3.0.3, dust 1.2.7, pdu 0.24.0, GNU `du`. Wall-clock seconds, one run each, 14 November 2026.

| Run                                         | Warm cache | Cold cache |
| ------------------------------------------- | ---------: | ---------: |
| `du -sx`                                    |       7.97 |      35.08 |
| gdu                                         |       2.52 |       8.30 |
| dua                                         |      17.12 |      22.68 |
| dust                                        |      27.41 |      29.38 |
| pdu                                         |      14.14 |      14.13 |
| Seal full scan, 1 walker                    |      12.16 |      38.78 |
| Seal full scan, 2 walkers                   |       6.23 |      23.15 |
| Seal full scan, 4 walkers                   |       3.22 |      12.40 |
| Seal full scan, 8 walkers                   |       1.86 |       9.20 |
| Seal full scan, 8 walkers (second run)      |       1.84 |       7.64 |
| **Seal incremental, nothing changed**       |   **0.51** |   **2.34** |
| **Seal incremental, 5,000 folders changed** |   **0.53** |   **1.93** |

Seal's times include assembling and writing the index file (30.3 MiB). Peak memory of a scan with 8 walkers was 285 MB for this tree; the daemon between scans holds only the summaries.

What the numbers say:

- A full scan with 8 walkers is 4.3 times faster than `du` warm and 3.8 to 4.6 times faster cold. It is faster than gdu warm (1.86 s against 2.52 s). Cold, one run was 11% slower than gdu (9.20 s against 8.30 s) and the other 8% faster (7.64 s).
- Walkers scale almost linearly to 4 (3.8 times one walker) and reach 6.5 times at 8 on 8 vCPUs.
- An incremental scan is 3.5 times faster than a full one warm and 3.3 to 4.8 times faster cold, and 15 times faster than `du` either way. The cost of 5,000 changed folders (1% of the tree) is lost in the noise.
- The "nothing changed" row is not zero work beyond the `lstat` per folder: from the second benchmark run on, the tree holds 5,000 folders with week-old files, which the hot-folder rule reads again.
- dua, dust and pdu spent most of their time in the kernel on this VM (60 to 180 seconds of system CPU across 8 threads for a 15 to 30 second run) and barely changed between warm and cold. That was not investigated; on other hardware they may do better. It did not affect the decision, which rests on packaging and on the missing incremental mode.

**End to end.** The same VM's own root disk (6.0 million files in 605,000 folders, including the benchmark tree) was indexed through the real path: the host script that `queryMachineDiskIndex` sends, the program copied from a production build, and the daemon started with `ionice -c 3 nice -n 19`. The first scan took 4.8 seconds with a warm cache and wrote a 36.6 MB index. An earlier first scan by a daemon at `nice -n 19`, while the test suite was using every core, took 16.3 seconds. Later requests were answered from the stored index in 0.3 seconds, including starting the query client. The index's totals for `/usr` and `/opt` matched `du -sx` to the byte.

The benchmark was run on the development VM. It has not been run on `kessel-ml` itself; the daemon's own figures for each disk (duration, files, mode) are on the mounts card after the first scan.

## Limits

- An SSH machine needs Node 20 or newer somewhere the script looks. Without it the panel works as before, on demand, and says the index is unavailable.
- File sizes inside a folder are not stored, only the 1,000 largest files of each disk. A file that grows without its folder changing, in a folder quiet for more than a week, is counted at its old size until the daily full scan.
- A folder moved between two indexed folders is read again in its new place; the index has no notion of a move.
- Totals are per user: folders the daemon's user cannot read are lower bounds.
- Windows machines are not indexed.

## Tests

| Test                                                   | Covers                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main/machines/disk-index/disk-index-scan.test.ts` | Hard-link shares, staying out of other filesystems and stops, unreadable folders, and an incremental rescan picking up added and removed folders |
