import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { applyWebsitesCommand, initialWebsites, validateWebsitesState, type WebsitesMutation, type WebsitesState } from '../shared/websites'

export const WEBSITES_KEY = 'websites:v1'
export interface WebsitesStorage { directory: string; get<T>(key: string, fallback: T): T; set(key: string, value: unknown): void }
export class WebsitesService {
  constructor(private store: WebsitesStorage) {}
  read(): WebsitesState {
    const value = this.store.get<unknown>(WEBSITES_KEY, null)
    if (value !== null) return validateWebsitesState(value)
    const state = initialWebsites(); this.store.set(WEBSITES_KEY, state); return state
  }
  mutate(request: WebsitesMutation): WebsitesState {
    if (!request || !Number.isSafeInteger(request.revision) || request.revision < 0) throw new Error('网站修订号无效，请刷新后重试')
    const previous = this.read()
    if (previous.revision !== request.revision) throw new Error('网站数据已更新，请刷新后重试，避免覆盖其他修改')
    const state = applyWebsitesCommand(previous, request.command, new Date().toISOString(), randomUUID)
    if (request.command.type === 'import' && request.command.mode === 'replace') {
      const folder = path.join(this.store.directory, 'websites-backups'); fs.mkdirSync(folder, { recursive: true })
      fs.writeFileSync(path.join(folder, 'before-restore-' + Date.now() + '-' + randomUUID() + '.json'), JSON.stringify(previous, null, 2), { encoding: 'utf8', flag: 'wx' })
    }
    try { this.store.set(WEBSITES_KEY, state) }
    catch (error) { try { this.store.set(WEBSITES_KEY, previous) } catch { /* Keep the original persistence error. */ } throw error }
    return state
  }
}
