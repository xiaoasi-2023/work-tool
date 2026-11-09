import { hasManagementData, validateManagementState, type ManagementMutation, type ManagementState } from './management'
import type { ManagementBackupPage, ManagementBackupRecord } from './types'

export const legacyManagementKey = 'workbench-management-v1'

export function createManagementWebClient(fetcher: typeof fetch, storage: { getItem(key: string): string | null }) {
  async function request<T>(path = '', body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await fetcher(`/api/management${path}`, {
        method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    } catch { throw new Error('无法连接本机管理数据服务，请确认浏览器调试服务正在运行') }
    let data: unknown
    try { data = await response.json() }
    catch { throw new Error('本机管理数据服务未连接，请刷新浏览器调试页面后重试') }
    if (!response.ok) throw new Error((data as { error?: string })?.error || '管理数据请求失败')
    return data as T
  }
  const requestState = async (path = '', body?: unknown): Promise<ManagementState> => validateManagementState(await request(path, body))
  async function read(): Promise<ManagementState> {
    const state = await requestState()
    if (hasManagementData(state)) return state
    const saved = storage.getItem(legacyManagementKey)
    if (!saved) return state
    let legacy: ManagementState
    try { legacy = validateManagementState(JSON.parse(saved)) }
    catch { throw new Error('旧浏览器管理数据格式无效，未自动迁移；原本地数据已保留') }
    return hasManagementData(legacy) ? requestState('/migrate', { data: legacy }) : state
  }
  return {
    read,
    mutate: (mutation: ManagementMutation) => requestState('/mutate', mutation),
    backup: async () => { await read(); return requestState('/backup') },
    backups: (page = 1) => request<ManagementBackupPage>(`/backups?page=${page}`),
    createBackup: () => request<ManagementBackupRecord>('/backups', {}),
    backupData: (id: string) => requestState(`/backups/${encodeURIComponent(id)}`),
    restoreBackup: (id: string, revision: number) => requestState(`/backups/${encodeURIComponent(id)}/restore`, { revision })
  }
}
