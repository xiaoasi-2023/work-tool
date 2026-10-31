const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { GitService } = require('../dist-electron/main/git.js')
const { Store } = require('../dist-electron/main/store.js')
const execute = promisify(execFile)
const settings = { gitPath: 'git', protectedBranches: ['main', 'master', 'develop', 'release/*'], theme: 'light' }
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
