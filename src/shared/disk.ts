export const DISK_RULE_VERSION = 1
export const DISK_SELECTION_LIMIT = 500
export type DiskAction = 'clean' | 'archive'
export type DiskKind = 'cache' | 'installer' | 'runtime' | 'backup' | 'dependency'
export interface DiskVolume { path: string; name: string; total: number; free: number }
export interface DiskFolder { path: string; bytes: number; files: number; partial: boolean }
export interface DiskFile { path: string; bytes: number; modifiedAt: string }
export interface DiskCandidate extends DiskFile {
  id: string; owner: string; kind: DiskKind; action: DiskAction | null; rule: string;
  reason: string; impact: string; files: number; fingerprint: string; blocked: string;
  handled?: DiskAction | 'restore'; handledAt?: string;
}
export interface DiskApp { id: string; name: string; bytes: number; files: number; paths: { path: string; bytes: number }[] }
export interface DiskSnapshot {
  schema: 1; ruleVersion: number; id: string; createdAt: string; root: string; home: string;
  source: 'native' | 'imported'; complete: boolean; volume: DiskVolume | null;
  bytes: number; files: number; directories: number; inaccessible: number; skippedLinks: number;
  elapsedMs: number; folders: DiskFolder[]; largeFiles: DiskFile[]; apps: DiskApp[];
  candidates: DiskCandidate[]; issues: { path: string; reason: string }[];
  changedAt?: string;
}
export interface DiskProgress { id: string; root: string; status: 'scanning' | 'complete' | 'cancelled' | 'failed'; files: number; bytes: number; directory: string; startedAt: string; error: string; snapshotId?: string }
export interface DiskOperationItem { path: string; bytes: number; success: boolean; message: string; archivedPath?: string; hash?: string; recoveryPath?: string; restoredAt?: string }
export interface DiskOperation { id: string; action: DiskAction | 'restore'; createdAt: string; finishedAt: string; destination: string; items: DiskOperationItem[]; freeBefore: number | null; freeAfter: number | null; sourceVolume: string; status: 'running' | 'complete' | 'interrupted' }
export interface DiskState { job: DiskProgress | null; snapshots: { id: string; createdAt: string; root: string; bytes: number; complete: boolean }[]; operations: DiskOperation[]; working: boolean }
export interface DiskPreview { id: string; action: DiskAction; snapshotId: string; destination: string; createdAt: string; items: DiskCandidate[]; bytes: number }
export interface DiskApi {
  environment(): Promise<{ home: string; volumes: DiskVolume[] }>;
  state(): Promise<DiskState>;
  start(root: string): Promise<DiskProgress>;
  cancel(): Promise<void>;
  snapshot(id: string): Promise<DiskSnapshot>;
  chooseFolder(purpose: 'scan' | 'archive'): Promise<string | null>;
  prepare(snapshotId: string, ids: string[], action: DiskAction, destination: string): Promise<DiskPreview>;
  execute(id: string): Promise<DiskOperation | null>;
  restore(id: string): Promise<DiskOperation | null>;
  reveal(path: string): Promise<void>;
  uninstall(): Promise<void>;
}
export const diskKindLabels: Record<DiskKind, string> = { cache: '可重建缓存', installer: '更新与安装包', runtime: '运行环境残留', backup: '历史备份', dependency: '开发依赖' }
export function diskPath(value: string): string { return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }
export function diskWithin(child: string, parent: string): boolean { const a = diskPath(child), b = diskPath(parent); return a === b || a.startsWith(`${b}/`) }
export function diskSnapshotAfterOperations(snapshot: DiskSnapshot, operations: DiskOperation[]): DiskSnapshot {
  if (snapshot.source !== 'native') return snapshot
  const events: { path: string; action: DiskOperation['action']; success: boolean; at: string; time: number }[] = []
  const scannedAt = Date.parse(snapshot.createdAt)
  for (const operation of operations) {
    const at = operation.finishedAt || operation.createdAt, time = Date.parse(at)
    if (!Number.isFinite(time) || time < scannedAt) continue
    for (const item of operation.items) {
      if (item.success || item.recoveryPath) events.push({ path: item.path, action: operation.action, success: item.success, at, time })
      if (item.archivedPath) events.push({ path: item.archivedPath, action: operation.action, success: item.success, at, time })
    }
  }
  const intersects = (a: string, b: string) => diskWithin(a, b) || diskWithin(b, a)
  const changes = events.filter(event => intersects(event.path, snapshot.root)).sort((a, b) => b.time - a.time)
  if (!changes.length) return snapshot
  const labels = { clean: '清理', archive: '归档', restore: '恢复' }
  return {
    ...snapshot,
    changedAt: Date.parse(snapshot.changedAt || '') > changes[0].time ? snapshot.changedAt : changes[0].at,
    candidates: snapshot.candidates.map(candidate => {
      const event = changes.find(event => intersects(event.path, candidate.path))
      if (!event || Date.parse(candidate.handledAt || '') > event.time) return candidate
      return { ...candidate, handled: event.success ? event.action : undefined, handledAt: event.at, blocked: event.success ? `此条目已${labels[event.action]}，重新扫描后可再次核对` : '此条目处理中断，请先检查操作记录中的恢复位置' }
    })
  }
}
export function diskBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes === 0) return '0 B'
  const unit = Math.min(4, Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)))
  return `${(bytes / 1024 ** Math.max(0, unit)).toLocaleString('zh-CN', { maximumFractionDigits: unit < 1 ? 0 : 2 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][Math.max(0, unit)]}`
}
export const diskOwners = [
  { id: 'codex', name: 'Codex', roots: ['.codex', '.cache/codex-runtimes', 'AppData/Roaming/Codex', 'AppData/Local/OpenAI', 'Documents/Codex'] },
  { id: 'cursor', name: 'Cursor', roots: ['.cursor', 'AppData/Roaming/Cursor', 'AppData/Local/Cursor'] },
  { id: 'claude', name: 'Claude', roots: ['.claude', 'AppData/Local/Claude', 'AppData/Local/Claude-3p', 'AppData/Local/Claude-Data'] },
  { id: 'kiro', name: 'Kiro / kirox', roots: ['.kiro', '.kirox', 'AppData/Roaming/kirox', 'AppData/Roaming/Kiro'] },
  { id: 'hermes', name: 'Hermes', roots: ['AppData/Local/hermes', 'AppData/Roaming/Hermes'] },
  { id: 'jetbrains', name: 'JetBrains', roots: ['AppData/Local/JetBrains', 'AppData/Roaming/JetBrains'] },
  { id: 'sublime', name: 'Sublime Text', roots: ['AppData/Local/Sublime Text', 'AppData/Roaming/Sublime Text'] },
  { id: 'doubao', name: '豆包', roots: ['Doubao', 'AppData/Local/Doubao', 'AppData/Roaming/Doubao'] },
  { id: 'workbuddy', name: 'WorkBuddy', roots: ['.workbuddy', 'WorkBuddy', 'AppData/Roaming/WorkBuddy'] },
  { id: 'qoder', name: 'Qoder', roots: ['.qoder', '.qoder-cli', 'AppData/Local/.qoder'] },
  { id: 'trae', name: 'Trae', roots: ['.trae-cn', 'AppData/Roaming/Trae CN'] },
  { id: 'browsers', name: '自动化浏览器', roots: ['.cache/puppeteer', '.agent-browser', '.cloakbrowser', 'AppData/Local/ms-playwright', 'AppData/Local/camoufox'] },
  { id: 'dependencies', name: '开发依赖缓存', roots: ['go/pkg/mod', '.npm', 'AppData/Local/uv', 'AppData/Local/pip', 'AppData/Local/electron', '.npminstall_tarball'] },
  { id: 'chrome', name: 'Chrome', roots: ['AppData/Local/google/Chrome'] },
  { id: 'nox', name: '模拟器共享文件', roots: ['Nox_share'] },
  { id: 'personal', name: '桌面与下载', roots: ['Desktop', 'Downloads'] },
]
export function diskOwner(path: string, home: string): { id: string; name: string; root: string } {
  for (const owner of diskOwners) for (const root of owner.roots) if (diskWithin(path, `${home}/${root}`)) return { id: owner.id, name: owner.name, root: `${home}/${root}` }
  const updater = diskPath(path).slice(diskPath(home).length).match(/^\/appdata\/local\/([^/]*-updater)(?:\/|$)/)
  if (diskWithin(path, home) && updater) return { id: 'updaters', name: '软件更新下载', root: `${home}/AppData/Local/${updater[1]}` }
  return { id: 'other', name: '其他文件', root: path }
}
export interface DiskRule { id: string; owner: string; kind: DiskKind; action: DiskAction | null; reason: string; impact: string; processes: string[]; minAgeDays: number }
export function diskRule(path: string, home: string, directory: boolean): DiskRule | null {
  if (!diskWithin(path, home)) return null
  const relative = diskPath(path).slice(diskPath(home).length + 1)
  const rule = (id: string, owner: string, kind: DiskKind, action: DiskAction | null, reason: string, impact: string, processes: string[] = [], minAgeDays = 0): DiskRule => ({ id, owner, kind, action, reason, impact, processes, minAgeDays })
  if (directory && /^appdata\/local\/sublime text\/(index|cache)$/.test(relative)) return rule('sublime-index', 'Sublime Text', 'cache', 'clean', '编辑器生成的索引或缓存', '关闭 Sublime 后处理，下次打开会重新建立索引。', ['sublime_text.exe'])
  if (directory && /^appdata\/local\/jetbrains\/(?:phpstorm|webstorm|intellijidea|pycharm|rider|goland)[^/]*\/(?:index|caches|jcef_cache)$/.test(relative)) return rule('jetbrains-cache', 'JetBrains', 'cache', 'clean', 'IDE 可重新生成的索引或缓存', '关闭相关 IDE 后处理，首次打开项目需要重新索引。设置、插件、本地历史保留。', ['phpstorm64.exe', 'webstorm64.exe', 'idea64.exe', 'pycharm64.exe', 'rider64.exe', 'goland64.exe'])
  if (directory && /^appdata\/local\/[^/]+-updater$/.test(relative)) return rule('updater-download', '软件更新下载', 'installer', 'clean', '软件升级下载目录', '仅处理超过 7 天、没有活动进程引用的下载目录。以后升级可能重新下载。', [], 7)
  if (directory && /^\.cache\/codex-runtimes\/(?:codex-primary-runtime\.previous-[^/]+|codex-runtime-install-[^/]+)$/.test(relative)) return rule('codex-runtime-leftover', 'Codex', 'runtime', 'clean', '旧运行环境或安装临时目录', '保留当前运行环境；请先退出 Codex，再清理超过 7 天的残留。', ['codex.exe', 'codex-code-mode-host.exe'], 7)
  if (!directory && /^appdata\/roaming\/cursor\/user\/globalstorage\/state\.vscdb\.backup\.\d{8}_\d{6}$/.test(relative)) return rule('cursor-backup', 'Cursor', 'backup', 'archive', '带日期的手工历史备份', '校验后归档到所选目录，再移出原位置；当前数据库和自动备份保留。', ['cursor.exe'])
  if (directory && /^(?:appdata\/local\/uv\/cache|go\/pkg\/mod|appdata\/local\/ms-playwright|\.cache\/puppeteer)$/.test(relative)) return rule('managed-dependency', diskOwner(path, home).name, 'dependency', null, '可能被多个项目引用的共享开发依赖', '请使用所属工具的依赖或缓存管理功能；这里提供占用分析和目录定位。')
  if (!directory && /^(?:downloads|desktop|nox_share)\//.test(relative) && !/(?:^|\/)(?:node_modules|\.git|\.venv|venv)(?:\/|$)/.test(relative) && /\.(?:apk|ipa|zip|7z|dmg|iso|msi|exe)$/.test(relative)) return rule('personal-installer', '个人安装包', 'installer', 'archive', '桌面、下载或模拟器目录中的安装文件', '校验后移动到归档目录，可从操作记录恢复；超过 1 天的文件才允许处理。', [], 1)
  return null
}
export function diskChanges(current: DiskSnapshot, previous: DiskSnapshot): { path: string; before: number; after: number; delta: number; partial: boolean }[] {
  if (diskPath(current.root) !== diskPath(previous.root) || current.ruleVersion !== previous.ruleVersion || !current.complete || !previous.complete) throw new Error('请选择相同扫描范围、相同规则且完整结束的两次扫描')
  // Folder lists are bounded. Only compare recorded entries on both sides; an absent entry is not zero.
  const before = new Map(previous.folders.map(folder => [diskPath(folder.path), folder]))
  return current.folders.flatMap(folder => { const old = before.get(diskPath(folder.path)); return old ? [{ path: folder.path, before: old.bytes, after: folder.bytes, delta: folder.bytes - old.bytes, partial: folder.partial || old.partial }] : [] }).sort((a, b) => b.delta - a.delta)
}
export function importDiskSnapshot(value: unknown): DiskSnapshot {
  const input = value as any
  if (!input || typeof input !== 'object') throw new Error('扫描报告格式无效')
  const number = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : 0
  const text = (v: unknown) => typeof v === 'string' ? v.slice(0, 4096) : ''
  let folders: DiskFolder[] = [], largeFiles: DiskFile[] = [], root = '', home = '', bytes = 0, files = 0, inaccessible = 0, skippedLinks = 0, volume: DiskVolume | null = null, createdAt = '', complete = true, ruleVersion = DISK_RULE_VERSION
  const nativeFormat = input.schema === 1 && Array.isArray(input.folders) && typeof input.root === 'string'
  if (nativeFormat) {
    root = text(input.root); home = text(input.home); createdAt = text(input.createdAt); complete = input.complete === true
    ruleVersion = Number.isInteger(input.ruleVersion) && input.ruleVersion > 0 ? input.ruleVersion : 0
    folders = input.folders.slice(0, 5000).map((row: any) => ({ path: text(row.path), bytes: number(row.bytes), files: number(row.files), partial: !!row.partial }))
    largeFiles = (Array.isArray(input.largeFiles) ? input.largeFiles : []).slice(0, 200).map((row: any) => ({ path: text(row.path), bytes: number(row.bytes), modifiedAt: text(row.modifiedAt) }))
    bytes = number(input.bytes); files = number(input.files); inaccessible = number(input.inaccessible); skippedLinks = number(input.skippedLinks)
    if (input.volume) volume = { path: text(input.volume.path), name: text(input.volume.name), total: number(input.volume.total), free: number(input.volume.free) }
  } else if (Array.isArray(input.roots) && input.disk && typeof input.root === 'string') {
    root = text(input.root); home = text(input.home); createdAt = text(input.finished_at)
    for (const tree of input.roots.slice(0, 100)) {
      if (!Array.isArray(tree.directories)) continue
      for (const row of tree.directories.slice(0, 100000 - folders.length)) folders.push({ path: text(row.path), bytes: number(row.logical_bytes), files: number(row.files), partial: number(row.errors) > 0 })
      for (const row of (Array.isArray(tree.largest_files) ? tree.largest_files : []).slice(0, 200)) largeFiles.push({ path: text(row.path), bytes: number(row.logical_bytes), modifiedAt: text(row.modified_at) })
      bytes += number(tree.summary?.logical_bytes); files += number(tree.summary?.files); inaccessible += number(tree.summary?.errors); skippedLinks += number(tree.summary?.skipped_links)
    }
    if (!home) {
      const profiles = folders.filter(folder => /^[a-z]:[\\/]users[\\/][^\\/]+$/i.test(folder.path) && !/[\\/](?:public|default|default user|all users)$/i.test(folder.path)).sort((a, b) => b.bytes - a.bytes)
      home = profiles[0]?.path || ''
    }
    for (const row of (Array.isArray(input.root_files) ? input.root_files : []).slice(0, 1000)) {
      bytes += number(row.logical_bytes); files++
      if (number(row.logical_bytes) >= 32 * 1024 ** 2) largeFiles.push({ path: text(row.path), bytes: number(row.logical_bytes), modifiedAt: '' })
    }
    skippedLinks += Array.isArray(input.skipped_root_links) ? input.skipped_root_links.length : 0
    if (!folders.some(folder => diskPath(folder.path) === diskPath(root))) folders.push({ path: root, bytes, files, partial: inaccessible > 0 })
    volume = { path: root, name: '系统磁盘', total: number(input.disk.total_bytes), free: number(input.disk.free_bytes) }
  } else throw new Error('请导入磁盘空间助手导出的 JSON 扫描报告')
  if (!root || !home || !folders.length) throw new Error('扫描报告缺少范围、用户目录或目录数据')
  const apps: DiskApp[] = []
  if (nativeFormat && Array.isArray(input.apps)) {
    for (const row of input.apps.slice(0, 100)) apps.push({ id: text(row.id), name: text(row.name), bytes: number(row.bytes), files: number(row.files), paths: (Array.isArray(row.paths) ? row.paths : []).slice(0, 30).map((source: any) => ({ path: text(source.path), bytes: number(source.bytes) })) })
  } else for (const owner of diskOwners) {
    const paths = owner.roots.flatMap(relative => { const folder = folders.find(row => diskPath(row.path) === diskPath(`${home}/${relative}`)); return folder ? [{ path: folder.path, bytes: folder.bytes, files: folder.files }] : [] })
    if (paths.length) apps.push({ id: owner.id, name: owner.name, bytes: paths.reduce((sum, row) => sum + row.bytes, 0), files: paths.reduce((sum, row) => sum + row.files, 0), paths })
  }
  const candidates: DiskCandidate[] = []
  if (nativeFormat && Array.isArray(input.candidates)) {
    for (const row of input.candidates.slice(0, 500)) candidates.push({ id: `import-${candidates.length}`, path: text(row.path), owner: text(row.owner), kind: Object.hasOwn(diskKindLabels, row.kind) ? row.kind : 'dependency', action: ['clean', 'archive'].includes(row.action) ? row.action : null, rule: text(row.rule), reason: text(row.reason), impact: text(row.impact), bytes: number(row.bytes), files: number(row.files), modifiedAt: text(row.modifiedAt), fingerprint: '', blocked: '导入报告仅用于分析，请在桌面版重新扫描后操作' })
  } else for (const entry of [...folders.map(row => ({ ...row, directory: true, modifiedAt: '' })), ...largeFiles.map(row => ({ ...row, directory: false, files: 1 }))]) {
    const rule = diskRule(entry.path, home, entry.directory)
    if (rule && entry.bytes > 0) candidates.push({ id: `import-${candidates.length}`, path: entry.path, owner: rule.owner, kind: rule.kind, action: rule.action, rule: rule.id, reason: rule.reason, impact: rule.impact, bytes: entry.bytes, files: entry.files, modifiedAt: entry.modifiedAt, fingerprint: '', blocked: '导入报告仅用于分析，请在桌面版重新扫描后操作' })
  }
  return { schema: 1, ruleVersion, id: `import-${globalThis.crypto.randomUUID()}`, createdAt: Number.isFinite(Date.parse(createdAt)) ? createdAt : new Date().toISOString(), root, home, source: 'imported', complete, volume, bytes, files, directories: number(input.directories) || folders.length, inaccessible, skippedLinks, elapsedMs: number(input.elapsedMs), folders: folders.sort((a, b) => b.bytes - a.bytes).slice(0, 1000), largeFiles: largeFiles.sort((a, b) => b.bytes - a.bytes).slice(0, 200), apps: apps.sort((a, b) => b.bytes - a.bytes), candidates: candidates.sort((a, b) => b.bytes - a.bytes).slice(0, 500), issues: [] }
}
