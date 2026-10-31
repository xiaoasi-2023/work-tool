const fs = require('node:fs/promises')
const crypto = require('node:crypto')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

async function main() {
  const zip = path.resolve(process.argv[2])
  const expected = require('electron/checksums.json')['electron-v45.1.0-win32-x64.zip']
  const bytes = await fs.readFile(zip)
  const actual = crypto.createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) throw new Error('Electron ZIP checksum does not match the official npm package')
  const destination = path.resolve('node_modules/electron/dist')
  await fs.mkdir(destination, {recursive:true})
  execFileSync('tar.exe', ['-xf', zip, '-C', destination], {windowsHide:true, stdio:'ignore'})
  await fs.writeFile(path.resolve('node_modules/electron/path.txt'),'electron.exe','utf8')
  console.log('Electron 45.1.0 verified and extracted.')
}
main().catch(error => {console.error(error);process.exitCode=1})
