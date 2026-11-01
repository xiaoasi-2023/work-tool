import type { AppState, ToolboxApi, ToolId } from '../shared/types'
import { version } from '../../package.json'

declare global { interface Window { toolbox?: ToolboxApi } }
const key = 'workbench-preview'
const initial: AppState = { projects: [], favorites: [], recent: [], settings: { gitPath: 'git', protectedBranches: ['main', 'master', 'develop', 'release/*'], theme: 'light' }, history: [], dataPath: '', version, desktop: false }
function read(): AppState {
  try { return { ...initial, ...JSON.parse(localStorage.getItem(key) || '{}'), version } } catch { return structuredClone(initial) }
}
function write(state: AppState) { localStorage.setItem(key, JSON.stringify(state)) }
const native = async (): Promise<never> => { throw new Error('请在 Workbench 桌面程序中使用本地项目功能') }
const preview: ToolboxApi = {
  state: async () => read(), addProject: native, removeProject: native, inspect: native, fetch: native, checkout: native, deleteBranches: native,
  saveSettings: async settings => { write({ ...read(), settings }) },
  favorite: async (id: ToolId) => { const state = read(); state.favorites = state.favorites.includes(id) ? state.favorites.filter(item => item !== id) : [...state.favorites, id]; write(state) },
  visit: async (id: ToolId) => { const state = read(); state.recent = [id, ...state.recent.filter(item => item !== id)].slice(0, 10); write(state) },
  chooseGit: native, gitVersion: native, openData: native
}
export const api: ToolboxApi = window.toolbox || preview
