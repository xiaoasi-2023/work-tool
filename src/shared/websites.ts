import { decode as decodeHtml } from 'he'

export const WEBSITE_LIMIT = 5000
export const UNCATEGORIZED = 'uncategorized'
export type WebsiteIconMode = 'auto' | 'letter' | 'custom'
export interface WebsiteCategory { id: string; name: string; order: number }
export interface Website { id: string; name: string; url: string; categoryId: string; description: string; tags: string[]; icon: string; iconMode: WebsiteIconMode; favorite: boolean; pinned: boolean; order: number; createdAt: string; updatedAt: string; lastOpenedAt: string; openCount: number }
export interface WebsitesState { schema: 1; revision: number; categories: WebsiteCategory[]; items: Website[] }
export interface WebsiteDraft { id?: string; name: string; url: string; categoryId?: string; description?: string; tags?: string[]; icon?: string; iconMode?: WebsiteIconMode; favorite?: boolean; pinned?: boolean; order?: number }
export type WebsitesCommand =
  | { type: 'save-site'; value: WebsiteDraft }
  | { type: 'delete-sites'; ids: string[] }
  | { type: 'move-sites'; ids: string[]; categoryId: string }
  | { type: 'flag'; id: string; field: 'favorite' | 'pinned'; value: boolean }
  | { type: 'visit'; id: string }
  | { type: 'save-category'; value: { id?: string; name: string; order: number } }
  | { type: 'delete-category'; id: string }
  | { type: 'import'; data: unknown; mode: 'merge' | 'replace' }
export interface WebsitesMutation { revision: number; command: WebsitesCommand }
export interface WebsitesApi { read(): Promise<WebsitesState>; mutate(request: WebsitesMutation): Promise<WebsitesState>; open(id: string): Promise<WebsitesState> }

function text(value: unknown, label: string, limit: number, optional = false): string {
  if (value === undefined && optional) return ''
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) throw new Error(label + '格式无效')
  return value.trim()
}
function order(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1000000) throw new Error('排序请填写 0～1000000 的整数'); return value as number }
function date(value: unknown, fallback: string): string { if (value === undefined || value === '') return fallback; if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('网址日期格式无效'); return new Date(value).toISOString() }
function flag(value: unknown): boolean { if (value === undefined) return false; if (typeof value !== 'boolean') throw new Error('收藏或置顶状态无效'); return value }
const key = (value: string) => value.trim().toLocaleLowerCase()
export function websiteUrl(value: unknown): string {
  let input = text(value, '网址', 4096)
  if (/^[\w.-]+:\d+(?:[/?#]|$)/.test(input) || /^(?:localhost|127\.0\.0\.1|\[::1\])(?:[/?#]|$)/i.test(input) || /^\d{1,3}(?:\.\d{1,3}){3}(?:[/?#]|$)/.test(input)) input = 'http://' + input
  else if (!/^[a-z][a-z\d+.-]*:/i.test(input)) input = 'https://' + input
  let url: URL
  try { url = new URL(input) } catch { throw new Error('请填写有效的网址') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('网址仅支持 HTTP / HTTPS，且不能包含登录账号或密码')
  return url.href
}
export function websiteIcon(site: Pick<Website, 'url' | 'icon'> & Partial<Pick<Website, 'iconMode'>>): string {
  const mode = site.iconMode || (site.icon ? 'custom' : 'auto')
  return mode === 'letter' ? '' : mode === 'custom' ? site.icon : new URL('/favicon.ico', site.url).href
}

function normalizeSite(value: any, categories: WebsiteCategory[], now: string, id: () => string): Website {
  if (!value || typeof value !== 'object') throw new Error('网址记录格式无效')
  const categoryId = value.categoryId === undefined ? UNCATEGORIZED : text(value.categoryId, '分类', 120)
  if (!categories.some(category => category.id === categoryId)) throw new Error('所属分类不存在')
  const tags = value.tags === undefined ? [] : value.tags
  if (!Array.isArray(tags) || tags.length > 12) throw new Error('每个网站最多填写 12 个标签')
  const icon = text(value.icon, '图标网址', 4096, true)
  const iconMode: WebsiteIconMode = value.iconMode ?? (icon ? 'custom' : 'auto')
  if (!['auto', 'letter', 'custom'].includes(iconMode)) throw new Error('图标显示方式无效')
  if (iconMode === 'custom' && !icon) throw new Error('请填写图片地址，或者选择自动获取、名称首字')
  const count = value.openCount === undefined ? 0 : value.openCount
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('打开次数无效')
  return { id: value.id === undefined ? id() : text(value.id, '网址标识', 120), name: text(value.name, '名称', 120), url: websiteUrl(value.url), categoryId, description: text(value.description, '简介', 600, true), tags: [...new Set(tags.map(tag => text(tag, '标签', 40)))], icon: iconMode === 'custom' ? websiteUrl(icon) : '', iconMode, favorite: flag(value.favorite), pinned: flag(value.pinned), order: order(value.order ?? 100), createdAt: date(value.createdAt, now), updatedAt: date(value.updatedAt, now), lastOpenedAt: date(value.lastOpenedAt, ''), openCount: count }
}
export function validateWebsitesState(value: unknown): WebsitesState {
  const input = value as any
  if (!input || input.schema !== 1 || !Number.isSafeInteger(input.revision) || input.revision < 0 || !Array.isArray(input.categories) || !input.categories.length || input.categories.length > 100 || !Array.isArray(input.items) || input.items.length > WEBSITE_LIMIT) throw new Error('常用网站备份格式无效')
  const categories: WebsiteCategory[] = input.categories.map((row: any) => ({ id: text(row?.id, '分类标识', 120), name: text(row?.name, '分类名称', 40), order: order(row?.order) }))
  if (!categories.some(row => row.id === UNCATEGORIZED) || new Set(categories.map(row => row.id)).size !== categories.length || new Set(categories.map(row => key(row.name))).size !== categories.length) throw new Error('分类重复或缺少默认分类')
  const now = new Date().toISOString(), items = input.items.map((row: any) => normalizeSite(row, categories, now, () => { throw new Error('网址缺少标识') })) as Website[]
  if (new Set(items.map(row => row.id)).size !== items.length || new Set(items.map(row => row.url)).size !== items.length) throw new Error('备份中存在重复的网址或记录标识')
  return { schema: 1, revision: input.revision, categories, items }
}
export function initialWebsites(now = new Date().toISOString()): WebsitesState {
  const categories = [ ['development', '开发与代码'], ['cloud', '云服务'], ['ops', '运维监控'], ['ai', 'AI 工具'], ['company', '公司系统'], [UNCATEGORIZED, '未分类'] ].map(([id, name], index) => ({ id, name, order: index * 10 }))
  const seeds = [
    ['development', 'Apipost 帮助中心', 'https://wiki.apipost.cn/', '接口文档、调试、Mock 与团队协作。'],
    ['development', 'FastAPI 文档', 'https://fastapi.tiangolo.com/zh/', '路由、依赖注入、数据模型、测试与部署。'],
    ['development', 'GitHub', 'https://github.com/', '代码仓库、Pull Request、Actions 与 Issue。'],
    ['development', 'GSAP React 指南', 'https://gsap.com/resources/React/', 'React 集成、useGSAP 与动画清理。'],
    ['development', 'GSAP v3 文档', 'https://gsap.com/docs/v3/', 'Tween、Timeline 与插件 API。'],
    ['development', 'Pydantic 文档', 'https://docs.pydantic.dev/latest/', '模型、验证器、类型与序列化。'],
    ['development', 'SQLAlchemy 2.0 文档', 'https://docs.sqlalchemy.org/en/20/', 'ORM、Session、查询与数据库映射。'],
    ['development', 'ThinkPHP 5.1 完全开发手册', 'https://www.kancloud.cn/manual/thinkphp5_1/content', '路由、控制器、模型、验证与数据库。'],
    ['cloud', 'Cloudflare Dashboard', 'https://dash.cloudflare.com/', '站点、DNS、R2 与 WAF 管理入口。'],
    ['cloud', 'Cloudflare R2 文档', 'https://developers.cloudflare.com/r2/', '对象存储、Bucket、生命周期与定价。'],
    ['cloud', 'Cloudflare WAF 文档', 'https://developers.cloudflare.com/waf/', '访问规则、托管规则与安全事件。'],
    ['cloud', 'R2 S3 兼容 API', 'https://developers.cloudflare.com/r2/api/s3/api/', 'S3 兼容接口、签名与限制。'],
    ['ops', 'Docker 文档', 'https://docs.docker.com/', '镜像、容器、网络、存储与构建。'],
    ['ops', 'Docker Compose 文档', 'https://docs.docker.com/compose/', '服务编排、环境变量与部署配置。'],
    ['ops', 'PostgreSQL pg_dump', 'https://www.postgresql.org/docs/current/app-pgdump.html', '逻辑备份、格式选择与版本兼容。'],
    ['ops', 'PostgreSQL pg_restore', 'https://www.postgresql.org/docs/current/app-pgrestore.html', '备份恢复、对象选择与并行恢复。'],
    ['ai', 'OpenAI Codex 文档', 'https://developers.openai.com/codex/', '客户端、配置、工作流与技能。'],
    ['ai', 'Skills.sh', 'https://skills.sh/', '发现和查看 Agent Skills。'],
  ]
  return { schema: 1, revision: 0, categories, items: seeds.map(([categoryId, name, url, description], index) => normalizeSite({ id: 'starter-' + index, categoryId, name, url, description, order: index * 10 }, categories, now, () => '')) }
}

export interface WebsiteImport { state: WebsitesState; skipped: number; duplicates: number }
export function parseWebsiteImport(value: unknown): WebsiteImport {
  const input = value as any
  if (input?.schema === 1) return { state: validateWebsitesState(input), skipped: 0, duplicates: 0 }
  const rows = Array.isArray(input) ? input : input?.items
  if (!Array.isArray(rows) || !rows.length || rows.length > WEBSITE_LIMIT) throw new Error('请导入网站 JSON 备份或包含名称、网址的列表')
  const state: WebsitesState = { schema: 1, revision: 0, categories: [{ id: UNCATEGORIZED, name: '未分类', order: 1000 }], items: [] }
  let skipped = 0, duplicates = 0
  const seen = new Set<string>(), now = new Date().toISOString()
  for (const row of rows) {
    try {
      const url = websiteUrl(typeof row === 'string' ? row : row?.url)
      if (seen.has(url)) { duplicates++; continue }
      const name = typeof row === 'object' && row ? row.name || new URL(url).hostname : new URL(url).hostname
      const categoryName = typeof row === 'object' && row?.category ? text(row.category, '分类名称', 40) : '未分类'
      let category = state.categories.find(category => key(category.name) === key(categoryName))
      if (!category) { if (state.categories.length >= 100) throw new Error('分类过多'); category = { id: 'import-category-' + state.categories.length, name: categoryName, order: state.categories.length * 10 }; state.categories.push(category) }
      const site = normalizeSite({ ...(typeof row === 'object' ? row : {}), id: 'import-site-' + state.items.length, name, url, categoryId: category.id }, state.categories, now, () => '')
      state.items.push(site); seen.add(url)
    } catch { skipped++ }
  }
  if (!state.items.length) throw new Error('没有可导入的有效网址')
  return { state, skipped, duplicates }
}
export function parseWebsiteLines(value: string, category = '未分类'): WebsiteImport {
  return parseWebsiteImport(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => { const parts = line.split(/\s+\|\s+/); return { url: parts.at(-1), name: parts.length > 1 ? parts[0] : undefined, category } }))
}
export function parseBookmarkHtml(html: string): WebsiteImport {
  if (!/<(?:DL|A)\b/i.test(html)) throw new Error('请导入浏览器导出的书签 HTML 文件')
  const source = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const tokens = /<(H3|A)\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/\1\s*>|<\/?DL\b[^>]*>/gi
  const categories: string[] = [], rows: { name: string; url: string; category: string }[] = []
  const decode = (value: string) => decodeHtml(value.replace(/<[^>]*>/g, '')).trim()
  let pending = ''
  for (const token of source.matchAll(tokens)) {
    if (/^<\/DL/i.test(token[0])) categories.pop()
    else if (/^<DL/i.test(token[0])) { categories.push(pending || categories.at(-1) || '导入书签'); pending = '' }
    else if (token[1]?.toUpperCase() === 'H3') pending = decode(token[3])
    else {
      const href = token[2].match(/(?:^|\s)HREF\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/i)
      rows.push({ name: decode(token[3]), url: decodeHtml(href?.[1] ?? href?.[2] ?? href?.[3] ?? ''), category: categories.at(-1) || '导入书签' })
      if (rows.length > WEBSITE_LIMIT) throw new Error('一次最多导入 ' + WEBSITE_LIMIT + ' 个网站')
    }
  }
  return parseWebsiteImport(rows)
}

export function applyWebsitesCommand(previous: WebsitesState, command: WebsitesCommand, now: string, id: () => string): WebsitesState {
  const state = validateWebsitesState(previous)
  if (!command || typeof command !== 'object') throw new Error('网站操作格式无效')
  const findSite = (siteId: string) => { const site = state.items.find(row => row.id === siteId); if (!site) throw new Error('网址不存在，请刷新后重试'); return site }
  const category = (categoryId: string) => { const row = state.categories.find(row => row.id === categoryId); if (!row) throw new Error('分类不存在'); return row }
  const ids = (values: string[]) => { if (!Array.isArray(values) || !values.length || values.length > WEBSITE_LIMIT || new Set(values).size !== values.length) throw new Error('请选择不同的网站'); values.forEach(findSite); return new Set(values) }
  switch (command.type) {
    case 'save-site': {
      const existing = command.value?.id ? findSite(command.value.id) : undefined
      const iconMode = command.value?.iconMode ?? (command.value?.icon !== undefined ? text(command.value.icon, '图标网址', 4096, true) ? 'custom' : 'auto' : existing?.iconMode)
      const site = normalizeSite({ ...existing, ...command.value, iconMode, createdAt: existing?.createdAt || now, updatedAt: now, lastOpenedAt: existing?.lastOpenedAt || '', openCount: existing?.openCount || 0 }, state.categories, now, id)
      if (state.items.some(row => row.id !== site.id && row.url === site.url)) throw new Error('这个网址已经添加过了')
      if (existing) state.items[state.items.indexOf(existing)] = site; else state.items.push(site)
      break
    }
    case 'delete-sites': { const chosen = ids(command.ids); state.items = state.items.filter(row => !chosen.has(row.id)); break }
    case 'move-sites': { category(command.categoryId); const chosen = ids(command.ids); state.items.filter(row => chosen.has(row.id)).forEach(row => { row.categoryId = command.categoryId; row.updatedAt = now }); break }
    case 'flag': { if (!['favorite', 'pinned'].includes(command.field) || typeof command.value !== 'boolean') throw new Error('收藏或置顶状态无效'); const site = findSite(command.id); site[command.field] = command.value; site.updatedAt = now; break }
    case 'visit': { const site = findSite(command.id); site.lastOpenedAt = now; site.openCount++; break }
    case 'save-category': {
      const existing = command.value?.id ? category(command.value.id) : undefined
      const name = text(command.value?.name, '分类名称', 40)
      if (existing?.id === UNCATEGORIZED && name !== existing.name) throw new Error('默认分类名称保留为未分类')
      if (state.categories.some(row => row.id !== existing?.id && key(row.name) === key(name))) throw new Error('分类名称已经存在')
      const row = { id: existing?.id || id(), name, order: order(command.value.order) }
      if (existing) state.categories[state.categories.indexOf(existing)] = row; else state.categories.push(row)
      break
    }
    case 'delete-category': { category(command.id); if (command.id === UNCATEGORIZED) throw new Error('默认分类不能删除'); state.items.filter(row => row.categoryId === command.id).forEach(row => { row.categoryId = UNCATEGORIZED; row.updatedAt = now }); state.categories = state.categories.filter(row => row.id !== command.id); break }
    case 'import': {
      if (!['merge', 'replace'].includes(command.mode)) throw new Error('导入方式无效')
      const imported = parseWebsiteImport(command.data).state
      if (command.mode === 'replace') { state.categories = imported.categories; state.items = imported.items; break }
      const mapping = new Map<string, string>()
      for (const source of imported.categories) {
        let target = source.id === UNCATEGORIZED ? category(UNCATEGORIZED) : state.categories.find(row => key(row.name) === key(source.name))
        if (!target) { target = { ...source, id: id() }; state.categories.push(target) }
        mapping.set(source.id, target.id)
      }
      const urls = new Set(state.items.map(row => row.url))
      for (const source of imported.items) if (!urls.has(source.url)) { state.items.push({ ...source, id: id(), categoryId: mapping.get(source.categoryId)! }); urls.add(source.url) }
      break
    }
    default: throw new Error('未知的网站操作')
  }
  state.revision = previous.revision + 1
  return validateWebsitesState(state)
}
