const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const node = process.execPath
const children = []
const run = (file, args, env = {}) => {
  const child = spawn(file, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, windowsHide: true })
  children.push(child)
  return child
}
const stop = () => { for (const child of children) child.kill() }
process.on('SIGINT', () => { stop(); process.exit() })
process.on('SIGTERM', () => { stop(); process.exit() })
async function start() {
  await new Promise((resolve, reject) => run(node, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.electron.json']).on('exit', code => code === 0 ? resolve() : reject(new Error('Electron compilation failed'))))
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) })
  })
  const vite = run(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)])
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const env = { ...process.env, WORKBENCH_DEV_URL: url }
  delete env.ELECTRON_RUN_AS_NODE
  const electron = spawn(require('electron'), ['.'], { cwd: root, stdio: 'inherit', windowsHide: true, env })
  children.push(electron)
  electron.on('exit', code => { vite.kill(); process.exit(code || 0) })
}
start().catch(error => { console.error(error); stop(); process.exit(1) })
