import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { Store } from './store'
import { GitService } from './git'
import type { DeleteRequest, Settings, ToolId } from '../shared/types'
import { toolIds } from '../shared/types'
import { ManagementService } from './management'
import fs from 'node:fs'

let window: BrowserWindow
let store: Store
let git: GitService
let management: ManagementService
const running = new Set<string>()
async function exclusive<T>(id: string, action: () => Promise<T>): Promise<T> {
  if (running.has(id)) throw new Error('该项目正在执行操作，请稍后再试')
  running.add(id); try { return await action() } finally { running.delete(id) }
}
function register() {
  const handle = (channel: string, fn: (...args: any[]) => unknown) => ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('不允许的调用来源')
    return fn(...args)
  })
  handle('state', () => store.state(app.getVersion()))
  handle('management:state', () => management.read())
  handle('management:mutate', request => management.mutate(request))
  handle('management:backup', async () => {
    const state = management.read()
    const result = await dialog.showSaveDialog(window, { title: '备份研发管理数据', defaultPath: `Workbench-研发管理-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    management.backup(state, 'export')
    fs.writeFileSync(result.filePath, JSON.stringify(state, null, 2), 'utf8')
    return result.filePath
  })
  handle('management:restore', async () => {
    const before = management.read()
    const result = await dialog.showOpenDialog(window, { title: '恢复研发管理备份', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled) return null
    if (fs.statSync(result.filePaths[0]).size > 30 * 1024 * 1024) throw new Error('备份文件不能超过30 MB')
    const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8').replace(/^\uFEFF/, ''))
    return management.restore(data, before.revision)
  })
  handle('management:backups', (page?: number) => management.listBackups(page))
  handle('management:backup-create', () => management.createBackup())
  handle('management:backup-download', async (id: string) => {
    const state = management.readBackup(id)
    const result = await dialog.showSaveDialog(window, { title: '下载研发管理备份', defaultPath: id, filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, JSON.stringify(state, null, 2), 'utf8')
    return result.filePath
  })
  handle('management:backup-restore', (id: string, revision: number) => management.restoreBackup(id, revision))
  handle('project:add', async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择 Git 项目文件夹', properties: ['openDirectory'] })
    if (result.canceled) return null
    return store.add(await git.root(result.filePaths[0]))
  })
  handle('project:remove', (id: string) => { store.project(id); store.set('projects', store.projects().filter(p => p.id !== id)) })
  handle('git:inspect', (id: string, base?: string) => exclusive(id, () => git.inspect(store.project(id).path, base)))
  handle('git:fetch', (id: string) => exclusive(id, async () => {
    const p = store.project(id)
    try { await git.run(p.path, ['fetch', '--all', '--prune']); store.log(p.name, '刷新远程', '获取全部远程并清理失效引用', true) }
    catch (e) { store.log(p.name, '刷新远程', (e as Error).message, false); throw e }
  }))
  handle('git:checkout', (id: string, ref: string) => exclusive(id, async () => {
    const p = store.project(id)
    try { await git.checkout(p.path, ref); store.log(p.name, '切换分支', ref, true) }
    catch (e) { store.log(p.name, '切换分支', (e as Error).message, false); throw e }
  }))
  handle('git:delete', (request: DeleteRequest) => exclusive(request.projectId, async () => {
    if (!Array.isArray(request.refs) || !request.refs.every(r => typeof r === 'string') || typeof request.force !== 'boolean' || typeof request.baseRef !== 'string' || !request.expected) throw new Error('删除参数无效')
    const p = store.project(request.projectId)
    const results = await git.delete(p.path, request)
    for (const result of results) store.log(p.name, request.force ? '强制删除分支' : '删除分支', `${result.ref} · ${result.message}`, result.success)
    return results
  }))
  handle('settings:save', (s: Settings) => {
    if (!s || !['light', 'dark'].includes(s.theme) || typeof s.gitPath !== 'string' || !Array.isArray(s.protectedBranches) || !s.protectedBranches.every(item => typeof item === 'string' && item.length <= 200)) throw new Error('设置格式无效')
    store.set('settings', { ...s, gitPath: s.gitPath.trim() || 'git', protectedBranches: [...new Set(['main', 'master', 'develop', ...s.protectedBranches.filter(Boolean)])] })
  })
  for (const action of ['favorite', 'visit'] as const) handle(action, (id: ToolId) => {
    if (!toolIds.includes(id)) throw new Error('未知工具')
    store[action](id)
  })
  handle('git:choose', async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择 git.exe', filters: [{ name: 'Git executable', extensions: ['exe'] }], properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0]
  })
  handle('git:version', () => git.run(app.getPath('home'), ['--version']))
  handle('data:open', async () => { const error = await shell.openPath(store.directory); if (error) throw new Error(error) })
}
function createWindow() {
  window = new BrowserWindow({ width: 1380, height: 900, minWidth: 900, minHeight: 640, backgroundColor: '#f7f8fa', title: 'Workbench · 日常工具箱', icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  if (!app.isPackaged && process.env.WORKBENCH_DEV_URL) window.loadURL(process.env.WORKBENCH_DEV_URL)
  else window.loadFile(path.join(__dirname, '../../dist/index.html'))
}
const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus() } })
  app.whenReady().then(async () => {
    // Keep smoke tests and development data separate from installed application data.
    store = new Store(process.env.WORKBENCH_DATA_DIR || app.getPath('userData'))
    await store.init(); git = new GitService(() => store.settings()); management = new ManagementService(store); createWindow(); register()
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
  }).catch(error => { dialog.showErrorBox('Workbench 启动失败', String(error)); app.quit() })
  app.on('window-all-closed', () => app.quit())
}
