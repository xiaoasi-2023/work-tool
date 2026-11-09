import type { AppState, ToolboxApi, ToolId } from '../shared/types'
import { version } from '../../package.json'
import { createManagementWebClient } from '../shared/management-web-client'

declare global { interface Window { toolbox?: ToolboxApi } }
const key = 'workbench-preview'
const initial: AppState = { projects: [], favorites: [], recent: [], settings: { gitPath: 'git', protectedBranches: ['main', 'master', 'develop', 'release/*'], theme: 'light' }, history: [], dataPath: '', version, desktop: false }
function read(): AppState {
  try { return { ...initial, ...JSON.parse(localStorage.getItem(key) || '{}'), version } } catch { return structuredClone(initial) }
}
function write(state: AppState) { localStorage.setItem(key, JSON.stringify(state)) }
const native = async (): Promise<never> => { throw new Error('请在 Workbench 桌面程序中使用本地项目功能') }
const management = createManagementWebClient(window.fetch.bind(window), localStorage)
function downloadBackup(data: unknown, filename: string): string {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return filename
}
const preview: ToolboxApi = {
  state: async () => read(), addProject: native, removeProject: native, inspect: native, fetch: native, checkout: native, deleteBranches: native,
  saveSettings: async settings => { write({ ...read(), settings }) },
  favorite: async (id: ToolId) => { const state = read(); state.favorites = state.favorites.includes(id) ? state.favorites.filter(item => item !== id) : [...state.favorites, id]; write(state) },
  visit: async (id: ToolId) => { const state = read(); state.recent = [id, ...state.recent.filter(item => item !== id)].slice(0, 10); write(state) },
  chooseGit: native, gitVersion: native, openData: native,
  managementState: management.read,
  managementMutate: management.mutate,
  managementBackup: async () => downloadBackup(await management.backup(), `workbench-management-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
  managementRestore: async () => { throw new Error('请使用研发管理中的备份文件导入入口') },
  managementBackups: management.backups,
  managementCreateBackup: management.createBackup,
  managementBackupDownload: async id => downloadBackup(await management.backupData(id), id),
  managementBackupRestore: management.restoreBackup
}
export const api: ToolboxApi = window.toolbox || preview
