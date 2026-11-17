import fs from 'node:fs'
import path from 'node:path'

export function isSshRemote(url: string): boolean {
  if (/^(?:ssh|git\+ssh|ssh\+git):\/\//i.test(url)) return true
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(url) || /^[a-z]:[\\/]/i.test(url) || path.isAbsolute(url)) return false
  return /^(?:[^\s/@:]+@)?(?:\[[^\]]+\]|[^\s/:]+):.+$/.test(url)
}

export function isPuttyClient(file: string): boolean {
  return /(?:^|[\\/])(?:tortoisegitplink|plink)(?:\.exe)?$/i.test(file)
}

function isFile(file: string): boolean {
  try { return fs.statSync(file).isFile() } catch { return false }
}

export function getPuttySshEnvironment(key: string, environment: NodeJS.ProcessEnv = process.env, platform = process.platform): NodeJS.ProcessEnv {
  if (!isFile(key)) throw new Error('仓库配置的 PuTTY 密钥文件不存在，请检查 remote.<远程名>.puttykeyfile 指向的路径')
  const names = platform === 'win32' ? ['TortoiseGitPlink.exe', 'plink.exe'] : ['plink']
  const directories = (environment.PATH || environment.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean).map(directory => directory.replace(/^"(.*)"$/, '$1'))
  const installed = platform === 'win32' ? [...new Set([environment.ProgramW6432, environment.ProgramFiles, environment['ProgramFiles(x86)']].filter((value): value is string => Boolean(value)))].flatMap(directory => [path.join(directory, 'TortoiseGit', 'bin', 'TortoiseGitPlink.exe'), path.join(directory, 'PuTTY', 'plink.exe')]) : []
  const candidates = environment.GIT_SSH ? [environment.GIT_SSH, ...directories.map(directory => path.join(directory, environment.GIT_SSH!))] : [...installed, ...names.flatMap(name => directories.map(directory => path.join(directory, name)))]
  const client = candidates.find(isFile)
  if (!client) throw new Error('仓库使用 PuTTY 密钥（puttykeyfile），但未找到 TortoiseGitPlink 或 Plink。请安装 TortoiseGit/PuTTY，或通过 Git 的 core.sshCommand 配置可用的 SSH 客户端')
  // Git runs GIT_SSH_COMMAND through a shell, including on Windows.
  const quote = (value: string) => `'${(platform === 'win32' ? value.replace(/\\/g, '/') : value).replace(/'/g, "'\\''")}'`
  return { GIT_SSH_COMMAND: `${quote(client)} -batch -i ${quote(key)}`, GIT_SSH_VARIANT: 'plink' }
}

export function gitRemoteError(remote: string, message: string): string {
  let explanation = ''
  if (/host key verification failed|host key is not cached|host key is not trusted|cannot confirm a host key|host key does not match/i.test(message)) {
    explanation = 'SSH 服务器指纹尚未确认或已经变化。请先在终端或 TortoiseGit 中核对服务器指纹，再重新连接'
  } else if (/passphrase|encrypted private key|unable to use key file|couldn.t load private key/i.test(message)) {
    explanation = 'SSH 私钥无法加载或需要解锁。PuTTY 私钥请先在 Pageant 中加载并解锁；OpenSSH 私钥请使用对应的 ssh-agent'
  } else if (/permission denied \(publickey|no supported authentication methods|server refused our key|no more authentication methods/i.test(message)) {
    explanation = 'SSH 密钥认证失败。请确认使用了该远程对应的密钥，且公钥已添加到代码托管账号；加密私钥需要先在对应的密钥代理中解锁'
  }
  return `远程「${remote}」操作失败：${explanation ? `${explanation}\n\n${message}` : message}`
}
