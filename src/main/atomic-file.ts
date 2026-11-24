import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export function writeFileAtomic(file: string, data: string | Uint8Array) {
  const target = path.resolve(file), temporary = target + '.' + randomUUID() + '.tmp'
  try {
    fs.writeFileSync(temporary, data, { encoding: 'utf8', flag: 'wx' })
    const pause = new Int32Array(new SharedArrayBuffer(4))
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temporary, target); return }
      catch (error) {
        if (process.platform !== 'win32' || attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')) throw error
        Atomics.wait(pause, 0, 0, 50 * (attempt + 1))
      }
    }
  } finally { try { fs.unlinkSync(temporary) } catch { /* Renamed successfully, or retain the temporary file if it is still busy. */ } }
}
