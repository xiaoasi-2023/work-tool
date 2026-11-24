const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { once } = require('node:events')
const { initialWebsites, websiteUrl, websiteIcon, applyWebsitesCommand, parseWebsiteImport, parseWebsiteLines, parseBookmarkHtml, validateWebsitesState, UNCATEGORIZED } = require('../dist-electron/shared/websites.js')
const { WebsitesService, WEBSITES_KEY } = require('../dist-electron/main/websites.js')
const { createWebWebsitesMiddleware } = require('../dist-electron/main/web-websites.js')
const { createWebsitesWebClient } = require('../dist-electron/shared/websites-web-client.js')
const { Store } = require('../dist-electron/main/store.js')
const now = '2026-11-24T08:00:00.000Z'
let nextId = 0
const id = () => 'test-' + (++nextId)
const apply = (state, command, time = now) => applyWebsitesCommand(state, command, time, id)
function fixture(t) {
  const base = path.resolve('.runtime'); fs.mkdirSync(base, { recursive: true })
  const folder = fs.mkdtempSync(path.join(base, 'websites-test-'))
  t.after(() => { assert.ok(folder.startsWith(base + path.sep)); fs.rmSync(folder, { recursive: true, force: true }) })
  return folder
}
async function server(t, folder) {
  const middleware = createWebWebsitesMiddleware(folder)
  const app = http.createServer((request, response) => { void middleware(request, response, () => { response.statusCode = 404; response.end() }) })
  app.listen(0, '127.0.0.1'); await once(app, 'listening')
  t.after(() => new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve())))
  const url = 'http://127.0.0.1:' + app.address().port
  return { url, client: () => createWebsitesWebClient((input, init) => fetch(url + input, init)) }
}

test('website URLs support local ports, preserve meaningful paths and fragments, and reject executable schemes', () => {
  assert.equal(websiteUrl(' github.com '), 'https://github.com/')
  assert.equal(websiteUrl('HTTPS://GITHUB.COM:443'), 'https://github.com/')
  assert.equal(websiteUrl('localhost:3000/docs?q=1#intro'), 'http://localhost:3000/docs?q=1#intro')
  assert.equal(websiteUrl('192.168.1.20:8080/'), 'http://192.168.1.20:8080/')
  assert.notEqual(websiteUrl('https://docs.example.org/a#first'), websiteUrl('https://docs.example.org/a#second'))
  for (const input of ['javascript:alert(1)', 'file:///C:/test.exe', 'data:text/html,test', 'https://user:password@example.com/', 'http://']) assert.throws(() => websiteUrl(input))
})

test('starter websites validate and keep separate documents on the same domain', () => {
  const state = initialWebsites(now)
  assert.equal(state.items.length, 18)
  assert.equal(state.categories.length, 6)
  assert.deepEqual(validateWebsitesState(state), state)
  assert.equal(state.items.filter(site => new URL(site.url).hostname === 'docs.docker.com').length, 2)
})

test('legacy website records infer automatic or custom icons without losing previous images', () => {
  const legacy = initialWebsites(now)
  legacy.items.forEach(site => { delete site.iconMode })
  legacy.items[0].icon = 'https://images.example.org/logo.png'
  const restored = parseWebsiteImport(legacy).state
  assert.equal(restored.items[0].iconMode, 'custom')
  assert.equal(websiteIcon(restored.items[0]), 'https://images.example.org/logo.png')
  assert.equal(restored.items[1].iconMode, 'auto')
  assert.equal(websiteIcon(restored.items[1]), 'https://fastapi.tiangolo.com/favicon.ico')
  assert.equal(legacy.items[0].iconMode, undefined)
})

test('letter icons clear former images, avoid image requests and survive backup round trips', () => {
  const state = initialWebsites(now), original = state.items[0]
  const updated = apply(state, { type: 'save-site', value: { id: original.id, name: original.name, url: original.url, icon: 'https://example.org/old-logo.png', iconMode: 'letter' } })
  assert.equal(updated.items[0].iconMode, 'letter')
  assert.equal(updated.items[0].icon, '')
  assert.equal(websiteIcon(updated.items[0]), '')
  const restored = parseWebsiteImport(JSON.parse(JSON.stringify(updated))).state
  assert.equal(restored.items[0].iconMode, 'letter')
  assert.equal(websiteIcon(restored.items[0]), '')
  assert.equal(websiteIcon(original), 'https://wiki.apipost.cn/favicon.ico')
})

test('custom icon configuration requires a safe image URL and can be switched back to automatic', () => {
  const state = initialWebsites(now), value = { id: state.items[0].id, name: state.items[0].name, url: state.items[0].url }
  assert.throws(() => apply(state, { type: 'save-site', value: { ...value, iconMode: 'custom', icon: '' } }), /图片地址/)
  assert.throws(() => apply(state, { type: 'save-site', value: { ...value, iconMode: 'custom', icon: 'javascript:alert(1)' } }))
  assert.throws(() => apply(state, { type: 'save-site', value: { ...value, iconMode: 'unknown' } }), /显示方式/)
  const custom = apply(state, { type: 'save-site', value: { ...value, iconMode: 'custom', icon: 'https://cdn.example.org/logo.svg' } })
  assert.equal(websiteIcon(custom.items[0]), 'https://cdn.example.org/logo.svg')
  const automatic = apply(custom, { type: 'save-site', value: { ...value, iconMode: 'auto' } })
  assert.equal(automatic.items[0].icon, '')
  assert.equal(websiteIcon(automatic.items[0]), 'https://wiki.apipost.cn/favicon.ico')
  const oldClientEdit = apply(automatic, { type: 'save-site', value: { ...value, icon: 'https://cdn.example.org/legacy.png' } })
  assert.equal(oldClientEdit.items[0].iconMode, 'custom')
  assert.equal(websiteIcon(oldClientEdit.items[0]), 'https://cdn.example.org/legacy.png')
})

test('editing, pinning and visiting preserve established IDs and usage instead of resetting them', () => {
  const state = initialWebsites(now), site = state.items[0]
  const opened = apply(state, { type: 'visit', id: site.id })
  const pinned = apply(opened, { type: 'flag', id: site.id, field: 'pinned', value: true })
  const edited = apply(pinned, { type: 'save-site', value: { id: site.id, name: '接口文档', url: site.url, openCount: 0 } }, '2026-11-24T09:00:00.000Z')
  assert.equal(edited.items[0].openCount, 1)
  assert.equal(edited.items[0].lastOpenedAt, now)
  assert.equal(edited.items[0].createdAt, now)
  assert.equal(edited.items[0].updatedAt, '2026-11-24T09:00:00.000Z')
  assert.equal(edited.items[0].pinned, true)
  assert.equal(state.items[0].openCount, 0)
  assert.throws(() => apply(state, { type: 'flag', id: site.id, field: '__proto__', value: true }))
})

test('canonical duplicate detection allows distinct pages but fails atomically for an existing URL', () => {
  const state = initialWebsites(now), copy = structuredClone(state)
  assert.throws(() => apply(state, { type: 'save-site', value: { name: '重复', url: 'https://GITHUB.com:443/' } }), /已经添加/)
  assert.deepEqual(state, copy)
  const next = apply(state, { type: 'save-site', value: { name: '我的仓库', url: 'https://github.com/xiaoasi-2023/work-tool' } })
  assert.equal(next.items.length, state.items.length + 1)
  assert.equal(next.items.at(-1).categoryId, UNCATEGORIZED)
})

test('deleting a category preserves all websites and usage in the default category', () => {
  let state = apply(initialWebsites(now), { type: 'visit', id: 'starter-0' })
  state = apply(state, { type: 'delete-category', id: 'development' })
  assert.equal(state.items.length, 18)
  assert.equal(state.items[0].categoryId, UNCATEGORIZED)
  assert.equal(state.items[0].openCount, 1)
  assert.equal(state.categories.some(row => row.id === 'development'), false)
  assert.throws(() => apply(state, { type: 'delete-category', id: UNCATEGORIZED }), /不能删除/)
})

test('batch moves and deletes reject mixed invalid scopes without changing any records', () => {
  const state = initialWebsites(now), original = structuredClone(state)
  assert.throws(() => apply(state, { type: 'move-sites', ids: ['starter-0', 'unknown'], categoryId: 'cloud' }))
  assert.throws(() => apply(state, { type: 'delete-sites', ids: ['starter-0', 'starter-0'] }))
  assert.throws(() => apply(state, { type: 'save-category', value: { name: '开发与代码', order: 0 } }), /已经存在/)
  assert.deepEqual(state, original)
  const moved = apply(state, { type: 'move-sites', ids: ['starter-0', 'starter-1'], categoryId: 'company' })
  assert.equal(moved.items.filter(site => site.categoryId === 'company').length, 2)
  const removed = apply(moved, { type: 'delete-sites', ids: ['starter-0', 'starter-1'] })
  assert.equal(removed.items.length, 16)
})

test('browser bookmark HTML keeps nested folder associations, entities and skip counts without running markup', () => {
  const imported = parseBookmarkHtml('<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>开发</H3><DL><DT><A HREF="https://example.com/?a=1&amp;b=2">文档 &amp; 示例</A><DT><H3>接口</H3><DL><DT><A HREF="http://localhost:3000/">本地接口</A></DL><DT><A HREF="https://example.com/other">其他文档</A></DL><DT><H3>工具</H3><DL><DT><A HREF="javascript:alert(1)">不可执行</A><DT><A HREF="https://example.com/?a=1&amp;b=2">重复</A><!-- <A HREF="https://ignored.example">注释</A> --><script><A HREF="https://script.example">脚本</A></script></DL></DL>')
  assert.equal(imported.state.items.length, 3)
  assert.equal(imported.skipped, 1)
  assert.equal(imported.duplicates, 1)
  assert.equal(imported.state.items[0].name, '文档 & 示例')
  assert.equal(imported.state.items[0].url, 'https://example.com/?a=1&b=2')
  assert.equal(imported.state.categories.find(row => row.id === imported.state.items[1].categoryId).name, '接口')
  assert.equal(imported.state.categories.find(row => row.id === imported.state.items[2].categoryId).name, '开发')
})

test('multiline input previews usable links, auto names and duplicates before writing', () => {
  const parsed = parseWebsiteLines('GitHub | https://github.com/\nhttps://github.com\nlocalhost:3000\njavascript:alert(1)\n', '公司系统')
  assert.equal(parsed.state.items.length, 2)
  assert.equal(parsed.duplicates, 1)
  assert.equal(parsed.skipped, 1)
  assert.equal(parsed.state.items[0].name, 'GitHub')
  assert.equal(parsed.state.items[1].name, 'localhost')
  assert.equal(parsed.state.categories.find(category => category.id === parsed.state.items[0].categoryId).name, '公司系统')
})

test('merging imports maps categories by name and preserves existing labels and usage for duplicate links', () => {
  let state = apply(initialWebsites(now), { type: 'visit', id: 'starter-0' })
  state = apply(state, { type: 'flag', id: 'starter-0', field: 'favorite', value: true })
  const imported = parseWebsiteImport([{ name: '重复帮助', url: state.items[0].url, category: '开发与代码' }, { name: '公司项目', url: 'http://192.168.1.10:8080/', category: '公司系统' }])
  const merged = apply(state, { type: 'import', mode: 'merge', data: imported.state })
  assert.equal(merged.items.length, 19)
  assert.equal(merged.categories.length, 6)
  assert.equal(merged.items[0].name, state.items[0].name)
  assert.equal(merged.items[0].openCount, 1)
  assert.equal(merged.items[0].favorite, true)
  assert.equal(merged.items.at(-1).categoryId, 'company')
  assert.equal(merged.revision, state.revision + 1)
})

test('restoring backups uses the current revision and rejects malformed or duplicate backups atomically', () => {
  const state = initialWebsites(now), original = structuredClone(state), imported = structuredClone(state)
  imported.revision = 99; imported.items = []
  const restored = apply(state, { type: 'import', mode: 'replace', data: imported })
  assert.equal(restored.revision, 1)
  assert.equal(restored.items.length, 0)
  const invalid = structuredClone(state); invalid.items.push(structuredClone(invalid.items[0]))
  assert.throws(() => apply(state, { type: 'import', mode: 'replace', data: invalid }), /重复/)
  assert.throws(() => parseWebsiteImport({ schema: 1, items: [] }))
  assert.deepEqual(state, original)
})

test('desktop websites persist in SQLite, preserve other tool settings and back up before replacing data', async t => {
  const folder = fixture(t), store = new Store(folder); await store.init()
  store.set('favorites', ['git']); store.saveSettings({ gitPath: 'git', protectedBranches: ['release/*'], theme: 'dark' })
  const service = new WebsitesService(store), first = service.read()
  const saved = service.mutate({ revision: first.revision, command: { type: 'save-site', value: { name: '内网', url: 'http://192.168.1.2/' } } })
  const reopenedStore = new Store(folder); await reopenedStore.init(); const reopened = new WebsitesService(reopenedStore)
  assert.deepEqual(reopened.read(), saved)
  assert.deepEqual(reopenedStore.get('favorites', []), ['git'])
  assert.equal(reopenedStore.settings().theme, 'dark')
  assert.throws(() => reopened.mutate({ revision: 0, command: { type: 'delete-sites', ids: [saved.items[0].id] } }), /数据已更新/)
  const restored = reopened.mutate({ revision: saved.revision, command: { type: 'import', mode: 'replace', data: first } })
  assert.equal(restored.items.length, 18)
  const backup = fs.readdirSync(path.join(folder, 'websites-backups'))[0]
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'websites-backups', backup), 'utf8')), saved)
})

test('failed writes restore previous in-memory state and do not consume revisions', t => {
  const folder = fixture(t), values = new Map(), storage = { directory: folder, get: (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback, set: (key, value) => { values.set(key, structuredClone(value)); if (value.revision > 0) throw new Error('disk full') } }
  const service = new WebsitesService(storage), previous = service.read()
  assert.throws(() => service.mutate({ revision: 0, command: { type: 'delete-sites', ids: [previous.items[0].id] } }), /disk full/)
  assert.deepEqual(values.get(WEBSITES_KEY), previous)
})

test('independent browser clients share saved websites, reject stale writes, and survive service restart', async t => {
  const folder = fixture(t), app = await server(t, folder), first = app.client(), second = app.client()
  const initial = await first.read()
  const saved = await first.mutate({ revision: initial.revision, command: { type: 'save-site', value: { name: '公司系统', url: 'localhost:5208' } } })
  assert.deepEqual(await second.read(), saved)
  await assert.rejects(second.mutate({ revision: initial.revision, command: { type: 'delete-sites', ids: [saved.items[0].id] } }), /数据已更新/)
  const visited = await second.open(saved.items.at(-1).id)
  assert.equal(visited.items.at(-1).openCount, 1)
  const restarted = await server(t, folder)
  assert.deepEqual(await restarted.client().read(), visited)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'websites.json'), 'utf8')), visited)
})

test('website HTTP endpoints reject foreign origins, unsupported formats and malformed payloads', async t => {
  const folder = fixture(t), app = await server(t, folder), initial = await app.client().read()
  const foreign = await fetch(app.url + '/api/websites/mutate', { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(foreign.status, 403)
  const wrong = await fetch(app.url + '/api/websites/mutate', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })
  assert.equal(wrong.status, 415)
  const malformed = await fetch(app.url + '/api/websites/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
  assert.equal(malformed.status, 400)
  assert.deepEqual(await app.client().read(), initial)
})

test('corrupted browser storage stays intact and is never replaced with starter data', async t => {
  const folder = fixture(t); fs.writeFileSync(path.join(folder, 'websites.json'), '{broken', 'utf8')
  const app = await server(t, folder)
  await assert.rejects(app.client().read(), /无法读取/)
  assert.equal(fs.readFileSync(path.join(folder, 'websites.json'), 'utf8'), '{broken')
})
