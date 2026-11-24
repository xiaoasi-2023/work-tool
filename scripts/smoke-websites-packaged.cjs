// Validate packaged website persistence in Electron without creating a browser window.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const root = path.resolve(__dirname, '../.runtime'); fs.mkdirSync(root, { recursive: true })
  const folder = fs.mkdtempSync(path.join(root, 'websites-packaged-'))
  const env = { ...process.env, WORKBENCH_WEBSITES_SMOKE_DIR: folder }; delete env.ELECTRON_RUN_AS_NODE
  try {
    const result = spawnSync(require('electron'), [__filename, path.resolve(__dirname, '../release/win-unpacked/resources/app.asar')], { env, windowsHide: true, stdio: 'inherit', timeout: 30000 })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
    if (!process.exitCode) console.log('Packaged website persistence, import, backup and restore passed (no browser window).')
  } finally { assert.ok(folder.startsWith(root + path.sep)); fs.rmSync(folder, { recursive: true, force: true }) }
} else {
  const { app } = require('electron'), folder = process.env.WORKBENCH_WEBSITES_SMOKE_DIR
  if (!folder) throw new Error('Run this script through Node.js')
  const data = path.join(folder, 'electron-data'); fs.mkdirSync(data)
  app.setPath('userData', data); app.setPath('sessionData', data); app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    const archive = process.argv[2]
    const { Store } = require(path.join(archive, 'dist-electron/main/store.js'))
    const { WebsitesService } = require(path.join(archive, 'dist-electron/main/websites.js'))
    const { parseBookmarkHtml } = require(path.join(archive, 'dist-electron/shared/websites.js'))
    const store = new Store(path.join(folder, 'data')); await store.init()
    const service = new WebsitesService(store), original = service.read()
    assert.equal(original.items.length, 18)
    const imported = parseBookmarkHtml('<DL><DT><H3>Internal</H3><DL><DT><A HREF="http://localhost:3000/">Local</A></DL></DL>')
    const merged = service.mutate({ revision: original.revision, command: { type: 'import', mode: 'merge', data: imported.state } })
    assert.equal(merged.items.length, 19)
    const reopened = new Store(path.join(folder, 'data')); await reopened.init()
    const fresh = new WebsitesService(reopened); assert.deepEqual(fresh.read(), merged)
    const restored = fresh.mutate({ revision: merged.revision, command: { type: 'import', mode: 'replace', data: original } })
    assert.equal(restored.items.length, 18)
    assert.equal(fs.readdirSync(path.join(folder, 'data/websites-backups')).length, 1)
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
