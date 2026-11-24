const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { GitService } = require('../dist-electron/main/git.js')
const { getPuttySshEnvironment, gitRemoteError, isSshRemote } = require('../dist-electron/main/git-ssh.js')
const { Store } = require('../dist-electron/main/store.js')
const nativeFs = require('node:fs')
const execute = promisify(execFile)
const settings = { gitPath: 'git', protectedBranches: ['main', 'master', 'release/*'], theme: 'light' }
const service = new GitService(() => settings)
const git = async (cwd, ...args) => (await execute('git', args, { cwd, windowsHide: true })).stdout.trim()
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-git-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  const repo = path.join(temp, '\u4e2d\u6587 project')
  const remote = path.join(temp, 'remote.git')
  await fs.mkdir(repo)
  await git(temp, 'init', '--bare', '--initial-branch=main', remote)
  await git(repo, 'init', '--initial-branch=main')
  await git(repo, 'config', 'user.name', 'Workbench Test')
  await git(repo, 'config', 'user.email', 'workbench@example.invalid')
  await fs.writeFile(path.join(repo, 'base.txt'), 'base\n')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-m', 'initial')
  await git(repo, 'remote', 'add', 'origin', remote)
  await git(repo, 'push', '-u', 'origin', 'main')
  return { temp, repo, remote }
}
async function request(repo, refs, force = false) {
  const detail = await service.inspect(repo)
  return { projectId: 'test', refs, baseRef: detail.baseRef, force, expected: Object.fromEntries(detail.branches.map(b => [b.ref, b.hash])) }
}

test('detects nested Chinese paths, uncommitted files and branch protections', async t => {
  const { repo } = await fixture(t)
  await git(repo, 'branch', 'release/1.0')
  const nested = path.join(repo, 'nested'); await fs.mkdir(nested)
  assert.equal(await service.root(nested), await fs.realpath(repo))
  await fs.writeFile(path.join(repo, 'new.txt'), 'dirty')
  const d = await service.inspect(repo)
  assert.equal(d.current, 'main'); assert.equal(d.dirty, 1)
  assert.equal(d.branches.find(b => b.name === 'release/1.0').protected, true)
  assert.equal(d.branches.find(b => b.name === 'main').current, true)
  await assert.rejects(() => service.checkout(repo, 'refs/heads/release/1.0'), /未提交/)
  const result = await service.delete(repo, await request(repo, ['refs/heads/main', 'refs/heads/release/1.0'], true))
  assert.equal(result.every(r => !r.success), true)
})
test('removes merged local and remote branches, preserves main', async t => {
  const { repo, remote } = await fixture(t)
  await git(repo, 'branch', 'ai/merged'); await git(repo, 'push', 'origin', 'ai/merged')
  await git(repo, 'config', 'branch.ai/merged.description', 'obsolete branch')
  const result = await service.delete(repo, await request(repo, ['refs/heads/ai/merged', 'refs/remotes/origin/ai/merged']))
  assert.deepEqual(result.map(r => r.success), [true, true])
  assert.equal(await git(remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/ai/merged'), '')
  assert.notEqual(await git(repo, 'rev-parse', 'refs/heads/main'), '')
  await assert.rejects(() => git(repo, 'config', '--get', 'branch.ai/merged.description'))
})

test('develop can be protected explicitly or deleted locally and remotely without that rule', async t => {
  const { repo, remote } = await fixture(t)
  await git(repo, 'branch', 'develop')
  await git(repo, 'push', 'origin', 'develop')
  const refs = ['refs/heads/develop', 'refs/remotes/origin/develop']
  const protectedService = new GitService(() => ({ ...settings, protectedBranches: [...settings.protectedBranches, 'develop'] }))
  const protectedDetail = await protectedService.inspect(repo)
  assert.equal(protectedDetail.branches.filter(branch => refs.includes(branch.ref)).every(branch => branch.protected), true)
  assert.deepEqual((await protectedService.delete(repo, await request(repo, refs, true))).map(result => result.success), [false, false])
  const detail = await service.inspect(repo)
  assert.equal(detail.branches.filter(branch => refs.includes(branch.ref)).every(branch => !branch.protected), true)
  assert.deepEqual((await service.delete(repo, await request(repo, refs))).map(result => result.success), [true, true])
  assert.equal(await git(repo, 'for-each-ref', '--format=%(refname)', 'refs/heads/develop', 'refs/remotes/origin/develop'), '')
  assert.equal(await git(remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/develop'), '')
  assert.notEqual(await git(repo, 'rev-parse', 'refs/heads/main'), '')
})

test('atomic local deletion preserves commits changed after the final hash check', async t => {
  const { repo } = await fixture(t)
  const ref = 'refs/heads/ai/raced-local'
  await git(repo, 'switch', '-c', 'ai/raced-local')
  await fs.writeFile(path.join(repo, 'unique.txt'), 'unmerged')
  await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'unique commit')
  const changed = await git(repo, 'rev-parse', 'HEAD')
  await git(repo, 'switch', 'main')
  for (const force of [false, true]) {
    await git(repo, 'branch', '-f', 'ai/raced-local', 'main')
    const req = await request(repo, [ref], force)
    const racing = new GitService(() => settings)
    const run = racing.run.bind(racing)
    let injected = false
    racing.run = async (cwd, args) => {
      if (args[0] === 'update-ref' && args.includes('-d')) {
        await git(repo, 'update-ref', ref, changed)
        injected = true
      }
      return run(cwd, args)
    }
    const result = await racing.delete(repo, req)
    assert.equal(injected, true)
    assert.equal(result[0].success, false)
    assert.equal(await git(repo, 'rev-parse', ref), changed)
  }
})

test('local deletion rechecks worktree occupancy after inspecting the repository', async t => {
  const { repo, temp } = await fixture(t)
  const ref = 'refs/heads/ai/late-worktree'
  await git(repo, 'branch', 'ai/late-worktree')
  const req = await request(repo, [ref], true)
  const racing = new GitService(() => settings)
  const run = racing.run.bind(racing)
  let reads = 0
  racing.run = async (cwd, args) => {
    if (args[0] === 'worktree' && args[1] === 'list' && ++reads === 2) {
      await git(repo, 'worktree', 'add', path.join(temp, 'late-worktree'), 'ai/late-worktree')
    }
    return run(cwd, args)
  }
  const result = await racing.delete(repo, req)
  assert.equal(result[0].success, false)
  assert.match(result[0].message, /工作区/)
  assert.notEqual(await git(repo, 'rev-parse', ref), '')
})

test('batched divergence matches Git counts and supports older Git', async t => {
  const { repo } = await fixture(t)
  await git(repo, 'switch', '-c', 'feature')
  await fs.writeFile(path.join(repo, 'feature.txt'), 'feature')
  await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'feature')
  await git(repo, 'switch', 'main')
  await fs.writeFile(path.join(repo, 'main.txt'), 'main')
  await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'main advances')
  const hash = await git(repo, 'rev-parse', 'feature')
  for (let i = 0; i < 12; i++) await git(repo, 'branch', `feature-copy-${i}`, hash)
  const baseHash = await git(repo, 'rev-parse', 'main')
  const expected = (await git(repo, 'rev-list', '--left-right', '--count', `${baseHash}...${hash}`)).split(/\s+/).map(Number)
  for (const legacy of [false, true]) {
    const reading = new GitService(() => settings)
    const run = reading.run.bind(reading)
    let walks = 0
    reading.run = async (cwd, args) => {
      if (legacy && args.some(arg => arg.includes('%(ahead-behind:'))) throw new Error('fatal: unknown field name: ahead-behind')
      if (args[0] === 'rev-list') walks++
      return run(cwd, args)
    }
    const detail = await reading.inspect(repo)
    for (const branch of detail.branches.filter(b => b.hash === hash)) {
      assert.equal(branch.behind, expected[0]); assert.equal(branch.ahead, expected[1]); assert.equal(branch.merged, false)
    }
    assert.equal(walks, legacy ? 2 : 0)
  }
})
test('unmerged commits require force and stale local snapshots are rejected', async t => {
  const { repo } = await fixture(t)
  await git(repo, 'switch', '-c', 'ai/unmerged')
  await fs.writeFile(path.join(repo, 'feature.txt'), 'unique')
  await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'unique work')
  await git(repo, 'switch', 'main')
  const req = await request(repo, ['refs/heads/ai/unmerged'])
  assert.equal((await service.delete(repo, req))[0].success, false)
  assert.equal((await service.delete(repo, { ...req, force: true, expected: { 'refs/heads/ai/unmerged': '0'.repeat(40) } }))[0].success, false)
  assert.equal((await service.delete(repo, { ...req, force: true }))[0].success, true)
})
test('rejects branches occupied by another worktree', async t => {
  const { repo, temp } = await fixture(t)
  await git(repo, 'branch', 'ai/occupied')
  await git(repo, 'worktree', 'add', path.join(temp, 'worktree'), 'ai/occupied')
  const d = await service.inspect(repo)
  assert.equal(d.branches.find(b => b.name === 'ai/occupied').occupied, true)
  assert.equal((await service.delete(repo, await request(repo, ['refs/heads/ai/occupied'], true)))[0].success, false)
})
test('remote deletion lease rejects unseen server changes', async t => {
  const { repo, remote } = await fixture(t)
  await git(repo, 'branch', 'ai/raced'); await git(repo, 'push', 'origin', 'ai/raced')
  const req = await request(repo, ['refs/remotes/origin/ai/raced'])
  await git(repo, 'switch', '-c', 'new-commit')
  await fs.writeFile(path.join(repo, 'server.txt'), 'new')
  await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'server changed')
  const changed = await git(repo, 'rev-parse', 'HEAD')
  await git(repo, 'push', remote, 'HEAD:refs/heads/ai/raced')
  await git(repo, 'switch', 'main')
  const result = await service.delete(repo, req)
  assert.equal(result[0].success, false)
  assert.equal(await git(remote, 'rev-parse', 'refs/heads/ai/raced'), changed)
})
test('switches local branches and handles empty repositories', async t => {
  const { repo, temp } = await fixture(t)
  await git(repo, 'branch', 'ai/switch'); await service.checkout(repo, 'refs/heads/ai/switch')
  assert.equal((await service.inspect(repo)).current, 'ai/switch')
  const empty = path.join(temp, 'empty'); await fs.mkdir(empty); await git(empty, 'init', '--initial-branch=main')
  assert.equal((await service.inspect(empty)).branches.length, 0)
})
test('protects server default branch even when the cached default is missing', async t => {
  const { repo, remote } = await fixture(t)
  await git(repo, 'branch', 'trunk'); await git(repo, 'push', 'origin', 'trunk')
  await git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/trunk')
  const result = await service.delete(repo, await request(repo, ['refs/remotes/origin/trunk'], true))
  assert.equal(result[0].success, false)
  assert.match(result[0].message, /默认分支/)
  assert.notEqual(await git(remote, 'rev-parse', 'refs/heads/trunk'), '')
})
test('SQLite persists projects, favorites, settings and history across restarts', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-db-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  const store = new Store(temp); await store.init()
  const p = store.add(path.join(temp, '\u9879\u76ee'))
  store.favorite('git'); store.visit('json'); store.set('settings', settings)
  store.log(p.name, '\u5220\u9664', 'refs/heads/test', true)
  const reopened = new Store(temp); await reopened.init()
  const state = reopened.state('test')
  assert.equal(state.projects[0].id, p.id)
  assert.deepEqual(state.favorites, ['git']); assert.deepEqual(state.recent, ['json'])
  assert.equal(state.history[0].success, true); assert.equal(state.history[0].action, '\u5220\u9664')
})

test('settings omit develop by default and persist its removal without weakening main and master protection', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-settings-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  const store = new Store(temp)
  await store.init()
  assert.deepEqual(store.settings().protectedBranches, ['main', 'master', 'release/*'])
  store.set('settings', { ...settings, protectedBranches: ['main', 'master', 'develop', 'release/*', 'version_hotfix'] })
  store.saveSettings({ ...store.settings(), protectedBranches: ['release/*', 'version_hotfix'] })
  const reopened = new Store(temp)
  await reopened.init()
  assert.deepEqual(reopened.settings().protectedBranches, ['main', 'master', 'release/*', 'version_hotfix'])
  reopened.saveSettings({ ...reopened.settings(), protectedBranches: ['develop', 'develop', 'release/*'] })
  assert.deepEqual(reopened.settings().protectedBranches, ['main', 'master', 'develop', 'release/*'])
})

test('SQLite saving retries temporary Windows file locks and keeps binary data readable', { skip: process.platform !== 'win32' }, async t => {
  const base = path.resolve('.runtime'); await fs.mkdir(base, { recursive: true })
  const temp = await fs.mkdtemp(path.join(base, 'store-lock-'))
  t.after(() => { assert.ok(temp.startsWith(base + path.sep)); return fs.rm(temp, { recursive: true, force: true }) })
  const store = new Store(temp); await store.init()
  const database = path.join(temp, 'workbench.sqlite'), originalRename = nativeFs.renameSync
  let failures = 0
  t.mock.method(nativeFs, 'renameSync', (source, destination) => {
    if (destination === database && failures < 2) { failures++; throw Object.assign(new Error('temporary Windows lock'), { code: 'EPERM' }) }
    return originalRename(source, destination)
  })
  store.set('storage-check', { name: '中文持久化', value: 16 })
  const reopened = new Store(temp); await reopened.init()
  assert.equal(failures, 2)
  assert.deepEqual(reopened.get('storage-check', null), { name: '中文持久化', value: 16 })
  assert.equal((await fs.readdir(temp)).some(file => file.endsWith('.tmp')), false)
})

test('permanent database file locks preserve the previous database and remove temporary writes', { skip: process.platform !== 'win32' }, async t => {
  const base = path.resolve('.runtime'); await fs.mkdir(base, { recursive: true })
  const temp = await fs.mkdtemp(path.join(base, 'store-lock-'))
  t.after(() => { assert.ok(temp.startsWith(base + path.sep)); return fs.rm(temp, { recursive: true, force: true }) })
  const store = new Store(temp); await store.init(); store.set('storage-check', 'saved')
  const database = path.join(temp, 'workbench.sqlite'), previous = await fs.readFile(database), originalRename = nativeFs.renameSync
  t.mock.method(nativeFs, 'renameSync', (source, destination) => {
    if (destination === database) throw Object.assign(new Error('persistent Windows lock'), { code: 'EPERM' })
    return originalRename(source, destination)
  })
  assert.throws(() => store.set('storage-check', 'unsaved'), /persistent Windows lock/)
  assert.deepEqual(await fs.readFile(database), previous)
  assert.equal((await fs.readdir(temp)).some(file => file.endsWith('.tmp')), false)
  t.mock.restoreAll()
  const reopened = new Store(temp); await reopened.init()
  assert.equal(reopened.get('storage-check', null), 'saved')
})

async function puttyFixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-ssh-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  const clientDirectory = path.join(temp, 'program files', 'TortoiseGit', 'bin')
  await fs.mkdir(clientDirectory, { recursive: true })
  await fs.writeFile(path.join(clientDirectory, 'TortoiseGitPlink.exe'), '')
  await fs.writeFile(path.join(clientDirectory, 'plink'), '')
  const key = path.join(temp, "key with space and ' quote.ppk")
  await fs.writeFile(key, 'test fixture, not a private key')
  const environment = { ...process.env, ProgramW6432: path.join(temp, 'program files'), ProgramFiles: path.join(temp, 'program files'), PATH: clientDirectory, GIT_SSH: undefined, GIT_SSH_COMMAND: undefined, GIT_SSH_VARIANT: undefined }
  return { temp, key, environment }
}

test('SSH transport detection excludes local paths and non-SSH protocols', () => {
  for (const url of ['git@gitee.com:team/repo.git', 'gitee.com:repo.git', 'ssh://git@gitee.com:2222/repo.git', 'git@[::1]:repo.git']) assert.equal(isSshRemote(url), true, url)
  for (const url of ['https://gitee.com/team/repo.git', 'git://example.test/repo', 'file:///tmp/repo', 'C:/repo', 'D:\\repo', '/tmp/repo', '../remote.git']) assert.equal(isSshRemote(url), false, url)
})

test('PuTTY identities are passed through a compatible client without reading or changing the key', async t => {
  const { key, environment } = await puttyFixture(t)
  const before = await fs.readFile(key)
  const result = getPuttySshEnvironment(key, environment, 'win32')
  assert.equal(result.GIT_SSH_VARIANT, 'plink')
  assert.match(result.GIT_SSH_COMMAND, /TortoiseGitPlink\.exe' -batch -i '/)
  assert.ok(result.GIT_SSH_COMMAND.endsWith("key with space and '\\'' quote.ppk'"))
  assert.deepEqual(await fs.readFile(key), before)
  assert.equal(environment.GIT_SSH_COMMAND, undefined)
})

test('missing PuTTY identities and missing compatible clients produce actionable errors', async t => {
  const { temp, key } = await puttyFixture(t)
  assert.throws(() => getPuttySshEnvironment(path.join(temp, 'missing.ppk'), {}, 'win32'), /密钥文件不存在/)
  assert.throws(() => getPuttySshEnvironment(key, {}, 'win32'), /未找到.*Plink/)
})

test('fetch uses each SSH remote identity separately and never persists transport overrides', async t => {
  const { repo } = await fixture(t)
  const { temp, key, environment } = await puttyFixture(t)
  await git(repo, 'remote', 'set-url', 'origin', 'git@example.invalid:one.git')
  await git(repo, 'remote', 'add', 'other', 'git@example.invalid:two.git')
  const secondKey = path.join(temp, 'second.ppk')
  await fs.writeFile(secondKey, 'another test fixture')
  await git(repo, 'config', 'remote.origin.puttykeyfile', key)
  await git(repo, 'config', 'remote.other.puttykeyfile', secondKey)
  const before = await fs.readFile(path.join(repo, '.git', 'config'))
  const reading = new GitService(() => settings, { ...environment, PATH: `${environment.PATH}${path.delimiter}${process.env.PATH || ''}` })
  const run = reading.run.bind(reading)
  const calls = []
  reading.run = async (cwd, args, overrides) => {
    if (args[0] === 'fetch') { calls.push({ args, overrides }); return '' }
    return run(cwd, args, overrides)
  }
  await reading.fetch(repo)
  assert.deepEqual(calls.map(call => call.args), [['fetch', '--prune', '--', 'origin'], ['fetch', '--prune', '--', 'other']])
  assert.equal(calls[0].overrides.GIT_SSH_VARIANT, 'plink')
  assert.ok(calls[0].overrides.GIT_SSH_COMMAND.includes('key with space'))
  assert.ok(calls[1].overrides.GIT_SSH_COMMAND.includes('second.ppk'))
  assert.ok(!calls[1].overrides.GIT_SSH_COMMAND.includes('key with space'))
  assert.deepEqual(await fs.readFile(path.join(repo, '.git', 'config')), before)
})

test('explicit SSH commands and clients retain priority over legacy PuTTY settings', async t => {
  const { repo } = await fixture(t)
  await git(repo, 'remote', 'set-url', 'origin', 'git@example.invalid:one.git')
  await git(repo, 'config', 'remote.origin.puttykeyfile', path.join(repo, 'missing.ppk'))
  for (const mode of ['command', 'client', 'config']) {
    const environment = { ...process.env, GIT_SSH: undefined, GIT_SSH_COMMAND: undefined }
    if (mode === 'command') environment.GIT_SSH_COMMAND = 'custom-ssh -i custom-key'
    if (mode === 'client') environment.GIT_SSH = 'ssh'
    if (mode === 'config') await git(repo, 'config', 'core.sshCommand', 'ssh -i custom-key')
    const reading = new GitService(() => settings, environment)
    const run = reading.run.bind(reading)
    let invoked = false
    reading.run = async (cwd, args, overrides) => {
      if (args[0] === 'ls-remote') { invoked = true; assert.deepEqual(overrides, {}); return '' }
      return run(cwd, args, overrides)
    }
    await reading.runRemote(repo, ['ls-remote', '--', 'origin'], 'origin')
    assert.equal(invoked, true)
  }
})

test('HTTPS remotes ignore PuTTY key settings and push connections use the push URL', async t => {
  const { repo } = await fixture(t)
  await git(repo, 'remote', 'set-url', 'origin', 'https://example.invalid/repo.git')
  await git(repo, 'config', 'remote.origin.puttykeyfile', path.join(repo, 'missing.ppk'))
  const reading = new GitService(() => settings, { ...process.env, GIT_SSH: undefined, GIT_SSH_COMMAND: undefined })
  const run = reading.run.bind(reading)
  reading.run = async (cwd, args, overrides) => {
    if (args[0] === 'ls-remote' || args[0] === 'push') { assert.deepEqual(overrides, {}); return 'ok' }
    return run(cwd, args, overrides)
  }
  assert.equal(await reading.runRemote(repo, ['ls-remote', '--', 'origin'], 'origin'), 'ok')
  await git(repo, 'remote', 'set-url', 'origin', 'git@example.invalid:repo.git')
  await git(repo, 'remote', 'set-url', '--push', 'origin', 'https://example.invalid/repo.git')
  assert.equal(await reading.runRemote(repo, ['push', '--', 'origin', 'main'], 'origin'), 'ok')
})

test('fetch prunes stale tracking refs while preserving local branches and work files', async t => {
  const { repo, remote } = await fixture(t)
  await git(repo, 'branch', 'stale')
  await git(repo, 'push', 'origin', 'stale')
  await git(repo, 'config', 'remote.origin.puttykeyfile', path.join(repo, 'unused.ppk'))
  await fs.writeFile(path.join(repo, 'local.txt'), 'uncommitted work')
  const head = await git(repo, 'rev-parse', 'HEAD')
  await git(remote, 'update-ref', '-d', 'refs/heads/stale')
  await service.fetch(repo)
  assert.equal(await git(repo, 'for-each-ref', '--format=%(refname)', 'refs/remotes/origin/stale'), '')
  assert.equal(await git(repo, 'rev-parse', 'refs/heads/stale'), head)
  assert.equal(await git(repo, 'rev-parse', 'HEAD'), head)
  assert.equal(await fs.readFile(path.join(repo, 'local.txt'), 'utf8'), 'uncommitted work')
})

test('fetch honors skip flags and continues other remotes after authentication failure', async t => {
  const { repo } = await fixture(t)
  await git(repo, 'remote', 'add', 'other', 'https://example.invalid/other.git')
  await git(repo, 'remote', 'add', 'skip-one', 'https://example.invalid/skipped.git')
  await git(repo, 'remote', 'add', 'skip-two', 'https://example.invalid/skipped.git')
  await git(repo, 'config', 'remote.skip-one.skipFetchAll', 'true')
  await git(repo, 'config', 'remote.skip-two.skipDefaultUpdate', 'true')
  const reading = new GitService(() => settings)
  const run = reading.run.bind(reading)
  const visited = []
  reading.run = async (cwd, args, overrides) => {
    if (args[0] === 'fetch') {
      const remote = args.at(-1); visited.push(remote)
      if (remote === 'origin') throw new Error('Permission denied (publickey).')
      return ''
    }
    return run(cwd, args, overrides)
  }
  await assert.rejects(() => reading.fetch(repo), /origin.*SSH 密钥认证失败/)
  assert.deepEqual(visited, ['origin', 'other'])
})

test('remote authentication errors explain host trust and private-key unlocking separately', () => {
  assert.match(gitRemoteError('origin', 'Host key verification failed.'), /服务器指纹/)
  assert.match(gitRemoteError('origin', 'Unable to use key file (wrong passphrase)'), /Pageant/)
  assert.match(gitRemoteError('origin', 'Permission denied (publickey).'), /公钥已添加/)
  assert.match(gitRemoteError('origin', 'connection timed out'), /connection timed out/)
})
