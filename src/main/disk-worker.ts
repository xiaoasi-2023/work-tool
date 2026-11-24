import { parentPort, workerData } from 'node:worker_threads'
import { inspectDiskEntry, scanDisk } from './disk-scan'

try {
  if (workerData.mode === 'inspect') parentPort!.postMessage({ type: 'result', value: inspectDiskEntry(workerData.root) })
  else {
    const flag = new Int32Array(workerData.cancel)
    const value = scanDisk(workerData.root, workerData.home, () => Atomics.load(flag, 0) === 1, value => parentPort!.postMessage({ type: 'progress', value }))
    parentPort!.postMessage({ type: 'result', value })
  }
} catch (error) { parentPort!.postMessage({ type: 'failure', error: (error as Error).message }) }
