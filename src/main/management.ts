import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { applyManagementCommand, emptyManagementState, validateManagementState, type ManagementMutation, type ManagementState } from '../shared/management'
import type { ManagementBackupPage, ManagementBackupRecord } from '../shared/types'

export const MANAGEMENT_STORAGE_KEY = 'management:v1'
interface ManagementStorage {
  directory: string
  get<T>(key: string, fallback: T): T
  set(key: string, value: unknown): void
}
const backupReasons = {
  manual: '手动备份', export: '导出当前数据', restore: '恢复前自动备份', batch: '批量修改前自动备份',
  cleanup: '清理需求内容前自动备份', module: '调整模块前自动备份', transfer: '调整需求归属前自动备份',
  migration: '旧数据迁移备份', delete: '删除记录前自动备份'
} as const
type BackupReason = keyof typeof backupReasons
const backupLimit = 30 * 1024 * 1024
const backupName = /^management-[A-Za-z0-9-]+\.json$/

export class ManagementService {
  private backupCache = new Map<string, { modified: number; size: number; record: ManagementBackupRecord }>()
  constructor(private store: ManagementStorage, private storage: 'browser' | 'desktop' = 'desktop') {}

  read(): ManagementState {
    const saved = this.store.get<ManagementState | null>(MANAGEMENT_STORAGE_KEY, null)
    if (saved) return validateManagementState(saved)
    const database = path.join(this.store.directory, 'workbench.sqlite')
    if (fs.existsSync(database)) {
      const directory = this.backupDirectory()
      fs.copyFileSync(database, path.join(directory, `before-management-${this.stamp()}.sqlite`), fs.constants.COPYFILE_EXCL)
    }
    const initial = emptyManagementState()
    this.store.set(MANAGEMENT_STORAGE_KEY, initial)
    return initial
  }

  mutate(request: ManagementMutation): ManagementState {
    if (!request || !Number.isSafeInteger(request.revision) || request.revision < 0) throw new Error('管理数据修订号无效，请刷新后重试')
    const previous = this.read()
    if (request.revision !== previous.revision) throw new Error('管理数据已更新，请刷新后重试，避免覆盖其他修改')
    const next = applyManagementCommand(previous, request.command, new Date().toISOString(), randomUUID)
    const command = request.command
    const reason: BackupReason | undefined = command.type === 'restore' ? 'restore'
      : command.type === 'batch' ? 'batch' : command.type === 'delete' ? 'delete'
        : command.type === 'clear-requirement-details' || command.type === 'clear-requirement-history' ? 'cleanup'
          : command.type === 'project-module' && command.action !== 'create' ? 'module'
            : command.type === 'upsert' && command.entity === 'requirements' && (command.value.projectId !== undefined || command.value.versionId !== undefined) ? 'transfer' : undefined
    if (reason) this.backup(previous, reason)
    try { this.store.set(MANAGEMENT_STORAGE_KEY, next) }
    catch (error) {
      // Store mutates its in-memory SQLite before flushing; restore that state on write failure.
      try { this.store.set(MANAGEMENT_STORAGE_KEY, previous) } catch { /* Preserve the original write error. */ }
      throw error
    }
    return structuredClone(next)
  }

  backup(state: ManagementState = this.read(), reason: BackupReason = 'manual'): string {
    const file = path.join(this.backupDirectory(), `management-${reason}-r${state.revision}-${this.stamp()}.json`)
    fs.writeFileSync(file, JSON.stringify(validateManagementState(state), null, 2), { encoding: 'utf8', flag: 'wx' })
    return file
  }

  restore(data: unknown, revision: number): ManagementState { return this.mutate({ revision, command: { type: 'restore', data, reason: '恢复管理数据备份' } }) }

  listBackups(page = 1): ManagementBackupPage {
    if (!Number.isSafeInteger(page) || page < 1) throw new Error('备份页码无效')
    const directory = path.join(this.store.directory, 'management-backups'), pageSize = 10
    const files = fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && backupName.test(entry.name))
      .map(entry => ({ id: entry.name, modified: fs.statSync(path.join(directory, entry.name)).mtimeMs }))
      .sort((a, b) => b.modified - a.modified || b.id.localeCompare(a.id)) : []
    const currentPage = Math.min(page, Math.max(1, Math.ceil(files.length / pageSize)))
    return {
      storage: this.storage,
      dataFile: path.join(this.store.directory, this.storage === 'browser' ? 'management.json' : 'workbench.sqlite'),
      directory, page: currentPage, pageSize, total: files.length,
      records: files.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(file => this.backupRecord(file.id))
    }
  }

  createBackup(): ManagementBackupRecord { return this.backupRecord(path.basename(this.backup())) }

  readBackup(id: string): ManagementState {
    const file = this.backupFile(id), stat = fs.lstatSync(file)
    if (!stat.isFile()) throw new Error('备份必须是本地JSON文件')
    if (stat.size > backupLimit) throw new Error('备份文件不能超过30 MB')
    return validateManagementState(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')))
  }

  restoreBackup(id: string, revision: number): ManagementState { return this.restore(this.readBackup(id), revision) }

  private backupFile(id: string): string {
    if (typeof id !== 'string' || !backupName.test(id)) throw new Error('备份文件标识无效')
    const file = path.join(this.store.directory, 'management-backups', id)
    if (!fs.existsSync(file)) throw new Error('备份不存在或已被移走，请刷新记录')
    return file
  }

  private backupRecord(id: string): ManagementBackupRecord {
    const stat = fs.lstatSync(this.backupFile(id)), cached = this.backupCache.get(id)
    if (cached && cached.modified === stat.mtimeMs && cached.size === stat.size) return structuredClone(cached.record)
    const reason = id.match(/^management-([a-z]+)-r\d+-/)?.[1] as BackupReason | undefined
    const known = reason && Object.prototype.hasOwnProperty.call(backupReasons, reason) ? reason : undefined
    const record: ManagementBackupRecord = {
      id, createdAt: stat.mtime.toISOString(), size: stat.size, revision: null,
      source: known === 'manual' || known === 'export' ? 'manual' : known ? 'automatic' : 'history',
      reason: known ? backupReasons[known] : '历史备份', valid: false, error: '', counts: null
    }
    try {
      const state = this.readBackup(id)
      record.revision = state.revision; record.valid = true
      record.counts = { projects: state.projects.length, requirements: state.requirements.length, plans: state.plans.length, efforts: state.efforts.length }
    } catch (error) { record.error = error instanceof Error ? error.message : '备份文件无法读取' }
    this.backupCache.set(id, { modified: stat.mtimeMs, size: stat.size, record })
    return structuredClone(record)
  }

  private backupDirectory(): string {
    const directory = path.join(this.store.directory, 'management-backups')
    fs.mkdirSync(directory, { recursive: true })
    return directory
  }

  private stamp(): string { return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}` }
}
