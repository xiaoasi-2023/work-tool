import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID, type Hash } from 'node:crypto'
import { DISK_RULE_VERSION, diskOwner, diskRule, type DiskApp, type DiskCandidate, type DiskFolder, type DiskProgress, type DiskSnapshot, type DiskVolume } from '../shared/disk'

export function diskVolume(root: string): DiskVolume | null {
  try { const usage = fs.statfsSync(root); return { path: path.parse(path.resolve(root)).root, name: path.parse(path.resolve(root)).root, total: usage.blocks * usage.bsize, free: usage.bavail * usage.bsize } } catch { return null }
}
export function metadata(hash: Hash, relative: string, info: fs.Stats) {
  hash.update(JSON.stringify([relative.replace(/\\/g, '/'), info.isDirectory() ? 'd' : 'f', info.isDirectory() ? 0 : info.size, info.isDirectory() && !relative ? 0 : info.mtimeMs, String(info.ino)]))
}
export function inspectDiskEntry(root: string): { fingerprint: string; bytes: number; files: number; modifiedAt: string } {
  const hash = createHash('sha256'), stack = [root]
  let bytes = 0, files = 0, modified = 0
  while (stack.length) {
    const current = stack.pop()!, info = fs.lstatSync(current)
    if (info.isSymbolicLink()) throw new Error('目录中包含链接，已跳过处理')
    if (!info.isDirectory() && !info.isFile()) throw new Error('无法处理这种文件类型')
    const relative = path.relative(root, current)
    metadata(hash, relative, info); modified = Math.max(modified, info.mtimeMs)
    if (info.isDirectory()) {
      const children = fs.readdirSync(current).sort().reverse()
      for (const name of children) stack.push(path.join(current, name))
    } else { bytes += info.size; files++ }
  }
  return { fingerprint: hash.digest('hex'), bytes, files, modifiedAt: new Date(modified).toISOString() }
}
export function scanDisk(root: string, home: string, cancelled: () => boolean = () => false, progress: (value: Partial<DiskProgress>) => void = () => {}): DiskSnapshot {
  const started = Date.now(), folderMap = new Map<string, DiskFolder>(), apps = new Map<string, DiskApp>()
  const candidateMap = new Map<string, { value: DiskCandidate; hash: Hash; newest: number }>()
  const candidates: DiskCandidate[] = [], largeFiles: DiskSnapshot['largeFiles'] = [], issues: DiskSnapshot['issues'] = []
  const stack: { path: string; candidate?: string }[] = [{ path: root }]
  let bytes = 0, files = 0, directories = 0, inaccessible = 0, skippedLinks = 0, lastProgress = 0
  while (stack.length && !cancelled()) {
    const item = stack.pop()!
    let candidate = item.candidate
    try {
      const info = fs.lstatSync(item.path)
      if (info.isSymbolicLink()) {
        skippedLinks++
        if (candidate) candidateMap.get(candidate)!.value.blocked = '包含目录链接，已保护'
        continue
      }
      if (!info.isFile() && !info.isDirectory()) continue
      if (!candidate) {
        const rule = diskRule(item.path, home, info.isDirectory())
        if (rule && !(rule.id === 'personal-installer' && info.size < 32 * 1024 ** 2)) {
          candidate = item.path
          candidateMap.set(candidate, { value: { id: createHash('sha256').update(item.path).digest('hex').slice(0, 24), path: item.path, owner: rule.owner, kind: rule.kind, action: rule.action, rule: rule.id, reason: rule.reason, impact: rule.impact, bytes: 0, files: 0, modifiedAt: '', fingerprint: '', blocked: '' }, hash: createHash('sha256'), newest: 0 })
        }
      }
      if (candidate) {
        const state = candidateMap.get(candidate)!
        metadata(state.hash, path.relative(candidate, item.path), info)
        state.newest = Math.max(state.newest, info.mtimeMs)
      }
      if (info.isDirectory()) {
        directories++
        const folder: DiskFolder = { path: item.path, bytes: 0, files: 0, partial: false }
        folderMap.set(item.path, folder)
        try { for (const name of fs.readdirSync(item.path).sort().reverse()) stack.push({ path: path.join(item.path, name), candidate }) }
        catch (error) { throw error }
      } else {
        bytes += info.size; files++
        const parent = folderMap.get(path.dirname(item.path))
        if (parent) { parent.bytes += info.size; parent.files++ }
        if (candidate) { const state = candidateMap.get(candidate)!; state.value.bytes += info.size; state.value.files++ }
        const owner = diskOwner(item.path, home)
        const app = apps.get(owner.id) || { id: owner.id, name: owner.name, bytes: 0, files: 0, paths: [] }
        app.bytes += info.size; app.files++
        const source = owner.id === 'other' ? path.join(root, path.relative(root, item.path).split(path.sep)[0]) : path.normalize(owner.root)
        let entry = app.paths.find(value => value.path === source)
        if (!entry) { entry = { path: source, bytes: 0 }; app.paths.push(entry) }
        entry.bytes += info.size
        apps.set(owner.id, app)
        if (info.size >= 32 * 1024 ** 2) {
          largeFiles.push({ path: item.path, bytes: info.size, modifiedAt: new Date(info.mtimeMs).toISOString() })
          if (largeFiles.length > 400) { largeFiles.sort((a, b) => b.bytes - a.bytes); largeFiles.length = 200 }
        }
      }
    } catch (error) {
      inaccessible++
      const folder = folderMap.get(item.path) || folderMap.get(path.dirname(item.path))
      if (folder) folder.partial = true
      if (candidate) candidateMap.get(candidate)!.value.blocked = '存在无法读取或已变化的文件，请重新扫描'
      if (issues.length < 80) issues.push({ path: item.path, reason: (error as NodeJS.ErrnoException).code || '无法读取' })
    }
    if (Date.now() - lastProgress >= 750) { progress({ files, bytes, directory: item.path }); lastProgress = Date.now() }
  }
  for (const folder of [...folderMap.values()].reverse()) {
    const parent = folderMap.get(path.dirname(folder.path))
    if (parent && folder.path !== root) { parent.bytes += folder.bytes; parent.files += folder.files; parent.partial ||= folder.partial }
  }
  for (const { value, hash, newest } of candidateMap.values()) {
    value.modifiedAt = new Date(newest).toISOString(); value.fingerprint = hash.digest('hex')
    const rule = diskRule(value.path, home, value.rule !== 'cursor-backup' && value.rule !== 'personal-installer')
    if (rule?.minAgeDays && Date.now() - newest < rule.minAgeDays * 86400000) value.blocked ||= `最近 ${rule.minAgeDays} 天有变动，暂时保留`
    if (value.bytes > 0) candidates.push(value)
  }
  return { schema: 1, ruleVersion: DISK_RULE_VERSION, id: randomUUID(), createdAt: new Date().toISOString(), root, home, source: 'native', complete: !cancelled(), volume: diskVolume(root), bytes, files, directories, inaccessible, skippedLinks, elapsedMs: Date.now() - started, folders: [...folderMap.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 1000), largeFiles: largeFiles.sort((a, b) => b.bytes - a.bytes).slice(0, 200), apps: [...apps.values()].map(app => ({ ...app, paths: app.paths.sort((a, b) => b.bytes - a.bytes).slice(0, 30) })).sort((a, b) => b.bytes - a.bytes), candidates: candidates.sort((a, b) => b.bytes - a.bytes).slice(0, 500), issues }
}
