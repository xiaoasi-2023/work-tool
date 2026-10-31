import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import type { Branch, DeleteRequest, DeleteResult, RepoDetail, Settings } from '../shared/types'

const execute = promisify(execFile)
export class GitService {
  constructor(private settings: () => Settings) {}
  async run(cwd: string, args: string[]) {
    try {
      const result = await execute(this.settings().gitPath || 'git', args, {
        cwd, encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', LC_ALL: 'C' }
      })
      return result.stdout.trimEnd()
    } catch (error) {
      const e = error as Error & { stderr?: string; code?: string; killed?: boolean }
      if (e.code === 'ENOENT') throw new Error('找不到 Git 或项目目录，请检查 Git 路径和项目文件夹')
      if (e.killed) throw new Error('Git 操作超时，请检查网络和认证配置后刷新仓库状态')
      throw new Error((e.stderr || e.message).trim())
    }
  }
  async root(directory: string) {
    const root = await this.run(directory, ['rev-parse', '--show-toplevel'])
    return fs.realpathSync(root)
  }
  async inspect(directory: string, chosenBase?: string, divergence = true): Promise<RepoDetail> {
    const [raw, head, status, remoteList, worktreeRaw] = await Promise.all([
      this.run(directory, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(subject)%00%(authorname)%00%(committerdate:iso-strict)%00%(upstream:short)%00%(symref)', 'refs/heads/', 'refs/remotes/']),
      this.run(directory, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''),
      this.run(directory, ['status', '--porcelain=v1', '-z']),
      this.run(directory, ['remote']),
      this.run(directory, ['worktree', 'list', '--porcelain'])
    ])
    const remotes = remoteList.split('\n').filter(Boolean).sort((a, b) => b.length - a.length)
    const occupied = new Set(worktreeRaw.split('\n').filter(line => line.startsWith('branch ')).map(line => line.slice(7)))
    const records = raw.split('\n').filter(Boolean).map(line => line.split('\0'))
    const refs = records.filter(fields => !fields[6]).map(fields => fields[0])
    const defaultRefs = records.filter(fields => fields[6]).map(fields => fields[6])
    const baseRef = chosenBase && refs.includes(chosenBase) ? chosenBase :
      ['refs/heads/main', 'refs/heads/master', ...defaultRefs, 'refs/heads/develop', `refs/heads/${head}`].find(ref => refs.includes(ref)) || refs[0] || ''
    const baseHash = records.find(fields => fields[0] === baseRef)?.[1] || ''
    const merged = new Set(baseHash ? (await this.run(directory, ['for-each-ref', `--merged=${baseHash}`, '--format=%(refname)', 'refs/heads/', 'refs/remotes/'])).split('\n') : [])
    const branches: Branch[] = []
    for (const fields of records) {
      const [ref, hash, subject, author, date, upstream, symref] = fields
      if (symref) continue
      const kind = ref.startsWith('refs/heads/') ? 'local' : 'remote'
      const name = ref.replace(/^refs\/(heads|remotes)\//, '')
      const remote = kind === 'remote' ? remotes.find(item => name.startsWith(`${item}/`)) || '' : ''
      const remoteBranch = remote ? name.slice(remote.length + 1) : ''
      const shortName = kind === 'local' ? name : remoteBranch
      const protectedBranch = this.settings().protectedBranches.some(pattern => {
        const escaped = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
        return new RegExp(`^${escaped}$`).test(shortName)
      }) || defaultRefs.includes(ref) || defaultRefs.some(target => kind === 'local' && target.endsWith(`/${name}`))
      branches.push({ ref, hash, name, kind, remote, remoteBranch, subject, author, date, upstream, current: kind === 'local' && name === head,
        protected: protectedBranch || ref === baseRef, occupied: occupied.has(ref), merged: merged.has(ref), ahead: 0, behind: 0 })
    }
    if (divergence && baseHash) {
      const compare = branches.filter(branch => branch.ref !== baseRef)
      let counts: string | null
      try {
        counts = await this.run(directory, ['for-each-ref', `--format=%(refname)%00%(objectname)%00%(ahead-behind:${baseHash})`, 'refs/heads/', 'refs/remotes/'])
      } catch (error) {
        // Git before 2.41 does not support the batched ahead-behind atom.
        if (!/unknown field name.*ahead-behind/i.test((error as Error).message)) throw error
        counts = null
      }
      const batch = new Map((counts || '').split('\n').map(line => {
        const [ref, hash, count] = line.split('\0')
        return [`${ref}\0${hash}`, count] as const
      }))
      const pending = compare.filter(branch => {
        const count = batch.get(`${branch.ref}\0${branch.hash}`)
        if (!count) return true
        const [ahead, behind] = count.split(/\s+/).map(Number)
        branch.ahead = ahead; branch.behind = behind; branch.merged = ahead === 0
        return false
      })
      // Fall back for older Git or refs changed during the batched read.
      const byHash = new Map<string, Branch[]>()
      for (const branch of pending) {
        const group = byHash.get(branch.hash)
        if (group) group.push(branch)
        else byHash.set(branch.hash, [branch])
      }
      const groups = [...byHash.entries()]
      for (let i = 0; i < groups.length; i += 8) await Promise.all(groups.slice(i, i + 8).map(async ([hash, items]) => {
        const count = await this.run(directory, ['rev-list', '--left-right', '--count', `${baseHash}...${hash}`])
        const [behind, ahead] = count.split(/\s+/).map(Number)
        for (const branch of items) { branch.behind = behind; branch.ahead = ahead; branch.merged = ahead === 0 }
      }))
    }
    // -z status entries can contain a second pathname for renames.
    const entries = status.split('\0'); let dirty = 0
    for (let i = 0; i < entries.length; i++) { if (entries[i]) { dirty++; if (/^[RC]|^.[RC]/.test(entries[i])) i++ } }
    return { current: head || '分离 HEAD', detached: !head, dirty, branches, baseRef, remotes }
  }
  async checkout(directory: string, ref: string) {
    const detail = await this.inspect(directory, undefined, false)
    const branch = detail.branches.find(item => item.ref === ref && item.kind === 'local')
    if (!branch) throw new Error('只能切换到现有本地分支')
    if (detail.dirty) throw new Error('存在未提交修改，请先在项目中提交或暂存后切换')
    if (branch.occupied && !branch.current) throw new Error('该分支已被其他工作区占用')
    await this.run(directory, ['switch', '--', branch.name])
  }
  async delete(directory: string, request: DeleteRequest): Promise<DeleteResult[]> {
    const results: DeleteResult[] = []
    if (!request.refs.length || request.refs.length > 500) throw new Error('请选择 1 至 500 个分支')
    const detail = await this.inspect(directory, request.baseRef, false)
    if (detail.baseRef !== request.baseRef) throw new Error('比较基准已不存在，请刷新后重试')
    for (const ref of [...new Set(request.refs)]) {
      try {
        let message = '已删除'
        const branch = detail.branches.find(item => item.ref === ref)
        if (!branch) throw new Error('分支已不存在')
        if (!request.expected[ref] || request.expected[ref] !== branch.hash) throw new Error('分支提交已变化，请刷新并重新确认')
        if (branch.current || branch.protected || branch.occupied) throw new Error('当前、保护、基准或工作区占用分支不可删除')
        const latestHash = await this.run(directory, ['rev-parse', '--verify', branch.ref])
        if (latestHash !== branch.hash) throw new Error('分支提交已变化，请刷新并重新确认')
        if (!request.force) {
          const merged = await this.run(directory, ['merge-base', '--is-ancestor', branch.hash, request.baseRef]).then(() => true, () => false)
          if (!merged) throw new Error('包含未合并提交，需要明确启用强制删除')
        }
        if (branch.kind === 'remote') {
          if (!branch.remote || !branch.remoteBranch) throw new Error('无法识别远程仓库')
          const remoteHead = await this.run(directory, ['ls-remote', '--symref', '--', branch.remote, 'HEAD'])
          const defaultRef = remoteHead.split('\n').find(line => line.startsWith('ref: '))?.split('\t')[0].slice(5)
          if (!defaultRef) throw new Error('无法确认服务器默认分支，已阻止远程删除')
          if (defaultRef === `refs/heads/${branch.remoteBranch}`) throw new Error('服务器默认分支不可删除')
          await this.run(directory, ['push', '--porcelain', `--force-with-lease=refs/heads/${branch.remoteBranch}:${branch.hash}`, '--', branch.remote, `:refs/heads/${branch.remoteBranch}`])
        } else {
          const worktrees = await this.run(directory, ['worktree', 'list', '--porcelain'])
          if (worktrees.split('\n').includes(`branch ${branch.ref}`)) throw new Error('该分支已被工作区占用，请刷新后重试')
          // Compare and delete under Git's ref lock, including forced deletions.
          // Do not dereference a concurrently replaced symbolic ref.
          await this.run(directory, ['update-ref', '--no-deref', '-d', branch.ref, branch.hash])
          try {
            const recreated = await this.run(directory, ['for-each-ref', '--format=%(refname)', branch.ref])
            if (!recreated) await this.run(directory, ['config', '--local', '--remove-section', `branch.${branch.name}`])
          } catch (error) {
            if (!/no such section/i.test((error as Error).message)) message = '已删除分支，但未能清理本地分支配置'
          }
        }
        results.push({ ref, success: true, message })
      } catch (error) { results.push({ ref, success: false, message: (error as Error).message }) }
    }
    return results
  }
}
