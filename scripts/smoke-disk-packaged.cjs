// Backend-only Electron smoke check. No BrowserWindow or browser session is created.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')

if (!process.versions.electron) {
  const base = path.resolve(__dirname, '../.runtime')
  fs.mkdirSync(base, { recursive: true })
  const fixture = fs.mkdtempSync(path.join(base, 'disk-packaged-'))
  const environment = { ...process.env, WORKBENCH_DISK_SMOKE_DIR: fixture }
  delete environment.ELECTRON_RUN_AS_NODE
  try {
    const result = spawnSync(require('electron'), [__filename, process.argv[2] || path.resolve(__dirname, '../release/win-unpacked/resources/app.asar')], { env: environment, windowsHide: true, stdio: 'inherit', timeout: 45000 })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
    if (!process.exitCode) console.log('Packaged Electron disk scan / clean / archive / restore passed (no browser window).')
  } finally {
    assert.ok(fixture.startsWith(base + path.sep))
    fs.rmSync(fixture, { recursive: true, force: true })
  }
} else {
  const { app } = require('electron')
  const fixture = process.env.WORKBENCH_DISK_SMOKE_DIR
  if (!fixture) throw new Error('Run this script through Node.js, not directly through Electron')
  const electronData = path.join(fixture, 'electron-data')
  fs.mkdirSync(electronData)
  app.setPath('userData', electronData)
  app.setPath('sessionData', electronData)
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    const { DiskSpaceService } = require(path.join(process.argv[2], 'dist-electron/main/disk-space.js'))
    const home = path.join(fixture, 'home'), archive = path.join(fixture, 'archive')
    const cache = path.join(home, 'AppData/Local/Sublime Text/Index/data.dat')
    const backup = path.join(home, 'AppData/Roaming/Cursor/User/globalStorage/state.vscdb.backup.20260605_141410')
    fs.mkdirSync(path.dirname(cache), { recursive: true })
    fs.mkdirSync(path.dirname(backup), { recursive: true })
    fs.mkdirSync(archive)
    fs.writeFileSync(cache, 'rebuildable fixture index')
    fs.writeFileSync(backup, 'archive fixture content')
    const service = new DiskSpaceService(path.join(fixture, 'data'), { home, processes: async () => [] })
    try {
      const environment = await service.environment()
      assert.ok(environment.volumes.length)
      await service.start(home)
      const deadline = Date.now() + 20000
      while (service.state().job.status === 'scanning') { if (Date.now() > deadline) throw new Error('Packaged worker timed out'); await delay(20) }
      const job = service.state().job
      assert.equal(job.status, 'complete', job.error)
      const snapshot = service.snapshot(job.snapshotId)
      const cleanup = await service.prepare(snapshot.id, [snapshot.candidates.find(candidate => candidate.rule === 'sublime-index').id], 'clean')
      assert.equal((await service.perform(cleanup.id)).items[0].success, true)
      assert.equal(fs.existsSync(cache), false)
      service.allowArchiveDestination(archive)
      const preview = await service.prepare(snapshot.id, [snapshot.candidates.find(candidate => candidate.rule === 'cursor-backup').id], 'archive', archive)
      const archived = await service.perform(preview.id)
      assert.equal(archived.items[0].success, true, archived.items[0].message)
      const restored = await service.restore(archived.id)
      assert.equal(restored.items[0].success, true, restored.items[0].message)
      assert.equal(fs.readFileSync(backup, 'utf8'), 'archive fixture content')
    } finally { await service.dispose() }
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
