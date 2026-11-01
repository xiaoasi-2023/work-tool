import initSqlJs, { Database } from 'sql.js'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppState, HistoryEntry, Project, Settings, ToolId } from '../shared/types'

export class Store {
  private db!: Database
  private file: string
  constructor(public directory: string) { this.file = path.join(directory, 'workbench.sqlite') }
  async init() {
    fs.mkdirSync(this.directory, { recursive: true })
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
    this.db = fs.existsSync(this.file) ? new SQL.Database(fs.readFileSync(this.file)) : new SQL.Database()
    this.db.run('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, time TEXT, project TEXT, action TEXT, detail TEXT, success INTEGER)')
    this.flush()
  }
  private flush() {
    const temp = `${this.file}.tmp`
    fs.writeFileSync(temp, this.db.export())
    fs.renameSync(temp, this.file)
  }
  get<T>(key: string, fallback: T): T {
    const stmt = this.db.prepare('SELECT value FROM kv WHERE key = ?')
    try { stmt.bind([key]); return stmt.step() ? JSON.parse(String(stmt.get()[0])) as T : fallback } finally { stmt.free() }
  }
  set(key: string, value: unknown) {
    this.db.run('INSERT OR REPLACE INTO kv VALUES (?, ?)', [key, JSON.stringify(value)])
    this.flush()
  }
  settings(): Settings { return this.get('settings', { gitPath: 'git', protectedBranches: ['main', 'master', 'develop', 'release/*'], theme: 'light' }) }
  projects(): Project[] { return this.get('projects', []) }
  project(id: string): Project {
    const project = this.projects().find(item => item.id === id)
    if (!project) throw new Error('项目不存在，请重新选择')
    return project
  }
  add(root: string): Project {
    const projects = this.projects()
    const existing = projects.find(item => path.resolve(item.path).toLowerCase() === path.resolve(root).toLowerCase())
    if (existing) return existing
    const project = { id: randomUUID(), name: path.basename(root), path: root, addedAt: new Date().toISOString() }
    this.set('projects', [...projects, project]); return project
  }
  log(project: string, action: string, detail: string, success: boolean) {
    this.db.run('INSERT INTO history (time, project, action, detail, success) VALUES (?, ?, ?, ?, ?)', [new Date().toISOString(), project, action, detail, success ? 1 : 0])
    this.db.run('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 500)')
    this.flush()
  }
  state(version: string): AppState {
    const stmt = this.db.prepare('SELECT * FROM history ORDER BY id DESC LIMIT 100')
    const history: HistoryEntry[] = []
    try { while (stmt.step()) { const row = stmt.getAsObject(); history.push({ ...row, success: Boolean(row.success) } as unknown as HistoryEntry) } } finally { stmt.free() }
    return { projects: this.projects(), settings: this.settings(), favorites: this.get('favorites', []), recent: this.get('recent', []), history, dataPath: this.directory, version, desktop: true }
  }
  favorite(id: ToolId) { const items = this.get<ToolId[]>('favorites', []); this.set('favorites', items.includes(id) ? items.filter(item => item !== id) : [...items, id]) }
  visit(id: ToolId) { this.set('recent', [id, ...this.get<ToolId[]>('recent', []).filter(item => item !== id)].slice(0, 10)) }
}
