import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { DISK_SELECTION_LIMIT, diskRule, diskWithin, diskPath, diskSnapshotAfterOperations, type DiskAction, type DiskCandidate, type DiskOperation, type DiskOperationItem, type DiskPreview, type DiskProgress, type DiskSnapshot, type DiskState, type DiskVolume } from '../shared/disk'
import { diskVolume } from './disk-scan'

const execute = promisify(execFile)
type ProcessInfo = { name: string; path: string }
const exists = (file: string) => { try { fs.lstatSync(file); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }
function replaceDiskFile(source: string, destination: string) {
  const pause = new Int32Array(new SharedArrayBuffer(4))
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(source, destination); return }
    catch (error) {
      if (process.platform !== 'win32' || attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')) throw error
      // Indexers and antivirus can briefly hold a Windows file without delete sharing.
      Atomics.wait(pause, 0, 0, 50 * (attempt + 1))
    }
  }
}
async function powershell(command: string): Promise<any> {
  const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${command}`], { windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 ** 2 })
  const data = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim() || '[]')
  return Array.isArray(data) ? data : [data]
}
async function processes(): Promise<ProcessInfo[]> {
  if (process.platform !== 'win32') throw new Error('当前系统尚不支持清理操作的进程占用检测')
  return (await powershell('Get-CimInstance Win32_Process | Select-Object Name,ExecutablePath | ConvertTo-Json -Compress')).map((row: any) => ({ name: String(row.Name || '').toLowerCase(), path: String(row.ExecutablePath || '') }))
}
export function assertPlainDiskPath(target: string, allowMissing = false): string {
  if (typeof target !== 'string' || !path.isAbsolute(target) || target.includes('\0') || target.length > 4096 || /^\\\\/.test(target)) throw new Error('请选择本机磁盘上的绝对路径')
  const resolved = path.resolve(target), parsed = path.parse(resolved)
  let current = parsed.root
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('路径中包含目录链接，已阻止处理') }
    catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return resolved; throw error }
  }
  return resolved
}
async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function copyVerified(source: string, destination: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(fs.createReadStream(source), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk) } }), fs.createWriteStream(destination, { flags: 'wx' }))
  const digest = hash.digest('hex')
  if (await hashFile(destination) !== digest) throw new Error('归档文件校验失败，原文件已保留')
  return digest
}
export class DiskSpaceService {
  private directory: string
  private snapshots: DiskState['snapshots'] = []
  private operations: DiskOperation[] = []
  private job: DiskProgress | null = null
  private flag?: Int32Array
  private scanWorker?: Worker
  private working = false
  private previews = new Map<string, DiskPreview>()
  private destinations = new Set<string>()
  readonly home: string
  constructor(directory: string, private options: { home?: string; processes?: () => Promise<ProcessInfo[]> } = {}) {
    this.directory = path.join(directory, 'disk-space'); this.home = path.resolve(options.home || os.homedir())
    fs.mkdirSync(this.directory, { recursive: true })
    const snapshots = this.read<DiskState['snapshots']>('index.json', []), operations = this.read<DiskOperation[]>('operations.json', [])
    this.snapshots = Array.isArray(snapshots) ? snapshots.filter(snapshot => snapshot && /^[a-f0-9-]{36}$/.test(snapshot.id)).slice(0, 12) : []
    this.operations = Array.isArray(operations) ? operations.filter(operation => operation && Array.isArray(operation.items) && typeof operation.id === 'string') : []
    for (const operation of this.operations) if (operation.status === 'running') { operation.status = 'interrupted'; operation.finishedAt = new Date().toISOString() }
  }
  private read<T>(name: string, fallback: T): T { try { return JSON.parse(fs.readFileSync(path.join(this.directory, name), 'utf8')) } catch { return fallback } }
  private write(name: string, data: unknown) {
    const file = path.join(this.directory, name), temporary = `${file}.${randomUUID()}.tmp`
    try { fs.writeFileSync(temporary, JSON.stringify(data), { encoding: 'utf8', flag: 'wx' }); replaceDiskFile(temporary, file) }
    finally { try { fs.unlinkSync(temporary) } catch { /* A successful rename already removed the temporary file; otherwise retain it if it is still busy. */ } }
  }
  state(): DiskState { return structuredClone({ job: this.job, snapshots: this.snapshots, operations: this.operations, working: this.working }) }
  async environment(): Promise<{ home: string; volumes: DiskVolume[] }> {
    let volumes: DiskVolume[] = []
    if (process.platform === 'win32') {
      try { volumes = (await powershell('Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress')).map((row: any) => ({ path: `${row.DeviceID}\\`, name: row.VolumeName || row.DeviceID, total: Number(row.Size) || 0, free: Number(row.FreeSpace) || 0 })) } catch { /* statfs still provides the profile volume. */ }
    }
    const fallback = diskVolume(this.home)
    if (!volumes.length && fallback) volumes.push(fallback)
    return { home: this.home, volumes }
  }
  private idle() { if (this.job?.status === 'scanning' || this.working) throw new Error('扫描或整理正在进行，请稍后再试') }
  async start(value: string): Promise<DiskProgress> {
    this.idle()
    const root = assertPlainDiskPath(value)
    if (!fs.statSync(root).isDirectory()) throw new Error('请选择文件夹或磁盘')
    const cancel = new SharedArrayBuffer(4)
    this.flag = new Int32Array(cancel)
    this.job = { id: randomUUID(), root, status: 'scanning', files: 0, bytes: 0, directory: root, startedAt: new Date().toISOString(), error: '' }
    const worker = new Worker(path.join(__dirname, 'disk-worker.js'), { workerData: { mode: 'scan', root, home: this.home, cancel } })
    this.scanWorker = worker
    worker.on('message', message => {
      if (this.scanWorker !== worker) return
      if (message.type === 'progress') Object.assign(this.job!, message.value)
      if (message.type === 'failure') { this.job!.status = 'failed'; this.job!.error = message.error }
      if (message.type === 'result') {
        try {
          const snapshot = message.value as DiskSnapshot
          this.write(`${snapshot.id}.json`, snapshot)
          this.snapshots.unshift({ id: snapshot.id, createdAt: snapshot.createdAt, root, bytes: snapshot.bytes, complete: snapshot.complete })
          while (this.snapshots.length > 12) { const old = this.snapshots.pop()!; try { fs.unlinkSync(path.join(this.directory, `${old.id}.json`)) } catch { /* A missing old snapshot is harmless. */ } }
          this.write('index.json', this.snapshots)
          Object.assign(this.job!, { status: snapshot.complete ? 'complete' : 'cancelled', files: snapshot.files, bytes: snapshot.bytes, snapshotId: snapshot.id })
        } catch (error) { this.job!.status = 'failed'; this.job!.error = (error as Error).message }
      }
    })
    worker.on('error', error => { if (this.scanWorker === worker) { this.job!.status = 'failed'; this.job!.error = error.message } })
    worker.on('exit', code => { if (this.scanWorker !== worker) return; if (this.job?.status === 'scanning') { this.job.status = 'failed'; this.job.error = `扫描进程意外结束 (${code})` } this.scanWorker = undefined })
    return structuredClone(this.job)
  }
  cancel() { if (this.flag && this.job?.status === 'scanning') Atomics.store(this.flag, 0, 1) }
  async dispose() { this.cancel(); await this.scanWorker?.terminate() }
  snapshot(id: string): DiskSnapshot {
    if (!this.snapshots.some(value => value.id === id) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('扫描记录不存在')
    const data = this.read<DiskSnapshot | null>(`${id}.json`, null)
    if (!data || data.schema !== 1) throw new Error('扫描记录损坏或已被移除')
    return diskSnapshotAfterOperations(data, this.operations)
  }
  private persistSnapshotChanges() {
    for (const entry of this.snapshots) {
      try {
        const snapshot = this.snapshot(entry.id)
        if (snapshot.changedAt) this.write(`${entry.id}.json`, snapshot)
      } catch { /* Operation history still supplies changed-item markers if a snapshot cannot be updated. */ }
    }
  }
  allowArchiveDestination(value: string) {
    const destination = assertPlainDiskPath(value)
    if (!fs.statSync(destination).isDirectory()) throw new Error('请选择归档文件夹')
    for (let current = destination; current !== path.dirname(current); current = path.dirname(current)) if (diskRule(current, this.home, true)) throw new Error('请在缓存和依赖目录之外选择独立的归档位置')
    this.destinations.add(diskPath(destination))
  }
  private inspect(root: string): Promise<{ fingerprint: string; bytes: number; files: number; modifiedAt: string }> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'disk-worker.js'), { workerData: { mode: 'inspect', root } })
      let settled = false
      worker.on('message', message => { settled = true; if (message.type === 'result') resolve(message.value); else reject(new Error(message.error)) })
      worker.on('error', reject)
      worker.on('exit', code => { if (!settled) reject(new Error(`文件核对进程意外结束 (${code})`)) })
    })
  }
  private async check(candidate: DiskCandidate, action: DiskAction, running: ProcessInfo[]) {
    const file = assertPlainDiskPath(candidate.path), info = fs.lstatSync(file), rule = diskRule(file, this.home, info.isDirectory())
    if (!rule || rule.id !== candidate.rule || rule.action !== action || candidate.blocked) throw new Error(candidate.blocked || '该位置不允许执行此操作')
    if (running.some(proc => rule.processes.includes(proc.name.toLowerCase()) || proc.path && diskWithin(proc.path, file) || rule.id === 'personal-installer' && proc.name.toLowerCase() === path.basename(file).toLowerCase())) throw new Error(`${candidate.owner} 正在使用相关文件，请退出软件后重试`)
    const now = await this.inspect(file)
    if (now.fingerprint !== candidate.fingerprint || now.bytes !== candidate.bytes) throw new Error('文件自扫描后发生变化，请重新扫描')
    if (rule.minAgeDays && Date.now() - Date.parse(now.modifiedAt) < rule.minAgeDays * 86400000) throw new Error(`最近 ${rule.minAgeDays} 天有变动，暂时保留`)
  }
  async prepare(snapshotId: string, ids: string[], action: DiskAction, destination = ''): Promise<DiskPreview> {
    this.idle()
    if (!['clean', 'archive'].includes(action) || !Array.isArray(ids) || !ids.length || ids.length > DISK_SELECTION_LIMIT || new Set(ids).size !== ids.length) throw new Error(`每次请选择 1～${DISK_SELECTION_LIMIT} 个不同条目`)
    const snapshot = this.snapshot(snapshotId)
    if (!snapshot.complete || snapshot.source !== 'native') throw new Error('请先完成本机扫描')
    const items = ids.map(id => snapshot.candidates.find(candidate => candidate.id === id))
    if (items.some(item => !item || !diskWithin(item.path, snapshot.root))) throw new Error('存在无效的候选条目')
    if (action === 'archive') {
      destination = assertPlainDiskPath(destination)
      if (!this.destinations.has(diskPath(destination))) throw new Error('请通过文件夹选择窗口指定归档位置')
      if (items.some(item => diskWithin(destination, item!.path) || diskWithin(item!.path, destination))) throw new Error('归档位置不能包含原文件，也不能位于原文件内')
    }
    this.working = true
    try {
      const running = await (this.options.processes || processes)()
      for (const item of items) await this.check(item!, action, running)
      const preview: DiskPreview = { id: randomUUID(), action, snapshotId, destination, createdAt: new Date().toISOString(), items: items as DiskCandidate[], bytes: items.reduce((sum, item) => sum + item!.bytes, 0) }
      this.previews.clear(); this.previews.set(preview.id, structuredClone(preview))
      return structuredClone(preview)
    } finally { this.working = false }
  }
  private saveOperations() {
    // Keep recovery metadata even after the routine activity history reaches its limit.
    this.operations = this.operations.filter((operation, index) => index < 100 || operation.items.some(item => item.recoveryPath || operation.action === 'archive' && item.hash && !item.restoredAt))
    this.write('operations.json', this.operations)
  }
  private saveArchiveManifest(operation: DiskOperation) {
    const folder = assertPlainDiskPath(path.join(operation.destination, 'Workbench-Archives', operation.id))
    const file = assertPlainDiskPath(path.join(folder, 'manifest.json'), true), temporary = path.join(folder, `.manifest-${randomUUID()}.tmp`)
    fs.writeFileSync(temporary, JSON.stringify({ schema: 1, operation }, null, 2), { encoding: 'utf8', flag: 'wx' })
    replaceDiskFile(temporary, file)
  }
  preview(id: string): DiskPreview {
    const preview = this.previews.get(id)
    if (!preview || Date.now() - Date.parse(preview.createdAt) > 5 * 60000) throw new Error('执行预览已过期，请重新检查')
    return structuredClone(preview)
  }
  async perform(id: string): Promise<DiskOperation> {
    this.idle()
    const preview = this.previews.get(id)
    this.previews.delete(id)
    if (!preview || Date.now() - Date.parse(preview.createdAt) > 5 * 60000) throw new Error('执行预览已过期，请重新检查')
    const snapshot = this.snapshot(preview.snapshotId), volume = diskVolume(snapshot.root)
    this.working = true
    const operation: DiskOperation = { id: randomUUID(), action: preview.action, createdAt: new Date().toISOString(), finishedAt: '', destination: preview.destination, items: [], freeBefore: volume?.free ?? null, freeAfter: null, sourceVolume: volume?.path || snapshot.root, status: 'running' }
    this.operations.unshift(operation)
    try {
      this.saveOperations()
      const running = await (this.options.processes || processes)()
      for (const candidate of preview.items) {
        const stage = path.join(path.dirname(candidate.path), `.workbench-${operation.id}-${randomUUID()}`)
        const item: DiskOperationItem = { path: candidate.path, bytes: candidate.bytes, success: false, message: '处理中', recoveryPath: stage }
        operation.items.push(item); this.saveOperations()
        try {
          await this.check(candidate, preview.action, running)
          if (exists(stage)) throw new Error('临时处理路径已存在')
          await fs.promises.rename(candidate.path, stage)
          assertPlainDiskPath(stage)
          if ((await this.inspect(stage)).fingerprint !== candidate.fingerprint) throw new Error('处理过程中文件发生变化，已停止')
          if (preview.action === 'clean') {
            // Only the sibling path created by this operation is removed. Never run shell deletion.
            if (path.dirname(stage) !== path.dirname(candidate.path) || !path.basename(stage).startsWith(`.workbench-${operation.id}-`)) throw new Error('处理路径核对失败')
            await fs.promises.rm(stage, { recursive: true, force: false })
          } else {
            if (!fs.lstatSync(stage).isFile()) throw new Error('当前版本只归档备份文件和个人安装文件')
            assertPlainDiskPath(preview.destination)
            const folder = path.join(preview.destination, 'Workbench-Archives', operation.id)
            await fs.promises.mkdir(folder, { recursive: true }); assertPlainDiskPath(folder)
            const archived = path.join(folder, `${candidate.id}-${path.basename(candidate.path)}`)
            item.archivedPath = archived; this.saveOperations()
            item.hash = await copyVerified(stage, archived); this.saveOperations()
            // Preserve original paths and hashes alongside the archive before removing the source.
            this.saveArchiveManifest(operation)
            if ((await this.inspect(stage)).fingerprint !== candidate.fingerprint) throw new Error('原文件在归档时发生变化，已保留原文件')
            await fs.promises.unlink(stage)
          }
          item.success = true; item.message = preview.action === 'clean' ? '缓存已清理' : '已校验并归档'; item.recoveryPath = undefined
        } catch (error) {
          item.message = (error as Error).message
          if (exists(stage) && !exists(candidate.path)) {
            try { assertPlainDiskPath(stage); assertPlainDiskPath(path.dirname(candidate.path)); await fs.promises.rename(stage, candidate.path); item.recoveryPath = undefined } catch { item.message += '；剩余文件位于恢复路径' }
          } else if (!exists(stage)) item.recoveryPath = undefined
        }
        this.saveOperations()
      }
      operation.status = 'complete'
    } finally {
      operation.finishedAt = new Date().toISOString(); operation.freeAfter = diskVolume(snapshot.root)?.free ?? null
      if (operation.status === 'running') operation.status = 'interrupted'
      this.working = false; this.saveOperations()
      this.persistSnapshotChanges()
      if (operation.action === 'archive' && operation.items.some(item => item.hash)) { try { this.saveArchiveManifest(operation) } catch { /* The local journal and first manifest still retain recovery data. */ } }
    }
    return structuredClone(operation)
  }
  async restore(id: string): Promise<DiskOperation> {
    this.idle()
    const original = this.operations.find(value => value.id === id && value.action === 'archive')
    if (!original) throw new Error('归档记录不存在')
    const candidates = original.items.filter(item => item.archivedPath && item.hash && !item.restoredAt)
    if (!candidates.length) throw new Error('没有可恢复的归档文件')
    const operation: DiskOperation = { id: randomUUID(), action: 'restore', createdAt: new Date().toISOString(), finishedAt: '', destination: '', items: [], freeBefore: diskVolume(original.sourceVolume)?.free ?? null, freeAfter: null, sourceVolume: original.sourceVolume, status: 'running' }
    this.working = true; this.operations.unshift(operation)
    try {
      this.saveOperations()
      const running = await (this.options.processes || processes)()
      for (const candidate of candidates) {
        const item: DiskOperationItem = { path: candidate.path, bytes: candidate.bytes, success: false, message: '' }
        operation.items.push(item)
        try {
          assertPlainDiskPath(candidate.archivedPath!); assertPlainDiskPath(candidate.path, true)
          const rule = diskRule(candidate.path, this.home, false)
          if (!rule || rule.action !== 'archive' || !diskWithin(candidate.archivedPath!, path.join(original.destination, 'Workbench-Archives', original.id))) throw new Error('归档路径核对失败')
          if (running.some(proc => rule.processes.includes(proc.name.toLowerCase()))) throw new Error('请先退出相关软件再恢复')
          if (exists(candidate.path)) throw new Error('原路径已有文件，已跳过，未覆盖')
          if (await hashFile(candidate.archivedPath!) !== candidate.hash) throw new Error('归档文件校验不一致，已停止恢复')
          await fs.promises.mkdir(path.dirname(candidate.path), { recursive: true }); assertPlainDiskPath(path.dirname(candidate.path))
          const temporary = path.join(path.dirname(candidate.path), `.workbench-restore-${operation.id}-${randomUUID()}`)
          item.recoveryPath = temporary; this.saveOperations()
          const digest = await copyVerified(candidate.archivedPath!, temporary)
          if (digest !== candidate.hash) throw new Error('恢复校验不一致，归档副本保留')
          // Creating a hard link is atomic and refuses to replace an existing original file.
          await fs.promises.link(temporary, candidate.path)
          await fs.promises.unlink(temporary); item.recoveryPath = undefined
          item.success = true; item.message = '已恢复到原路径，归档副本保留'; candidate.restoredAt = new Date().toISOString()
        } catch (error) { item.message = (error as Error).message }
        this.saveOperations()
      }
      operation.status = 'complete'
    } finally { operation.finishedAt = new Date().toISOString(); operation.freeAfter = diskVolume(original.sourceVolume)?.free ?? null; if (operation.status === 'running') operation.status = 'interrupted'; this.working = false; this.saveOperations(); this.persistSnapshotChanges() }
    return structuredClone(operation)
  }
}
